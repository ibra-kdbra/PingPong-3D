/**
 * Message transports for online play.
 *
 * A transport is { send(msg), onMessage(cb), onClose(cb), close() } carrying
 * JSON-serialisable objects. Two implementations:
 *  - PeerJS (WebRTC DataChannel, brokered by PeerJS' signalling server)
 *  - Loopback pair: two in-process ends with optional simulated latency and
 *    loss, for tests and local demos.
 */

/**
 * ICE servers. PeerJS ships one STUN server and its own (heavily
 * rate-limited) TURN relays; when both players sit behind NAT that needs a
 * relay — mobile data, corporate Wi-Fi, a VPN — those alone routinely fail
 * ICE, which surfaces as "Negotiation of connection ... failed". Offering
 * several STUN servers and more than one TURN relay, including TLS on 443
 * for networks that only allow HTTPS, makes a path far more likely.
 */
export const ICE_SERVERS = [
  {
    urls: [
      "stun:stun.l.google.com:19302",
      "stun:stun1.l.google.com:19302",
      "stun:stun.cloudflare.com:3478",
    ],
  },
  {
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:443",
      "turn:openrelay.metered.ca:443?transport=tcp",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: [
      "turn:staticauth.openrelay.metered.ca:80",
      "turn:staticauth.openrelay.metered.ca:443",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: ["turn:eu-0.turn.peerjs.com:3478", "turn:us-0.turn.peerjs.com:3478"],
    username: "peerjs",
    credential: "peerjsp",
  },
];

const BASE_CONFIG = { sdpSemantics: "unified-plan", iceCandidatePoolSize: 4 };
const signalling = {};

/**
 * Point the game at a self-hosted `peerjs-server` instead of the public
 * one (see NETPLAY.md): configureSignalling({ host, port, path, secure }).
 * Also how the end-to-end test drives a local server.
 */
export function configureSignalling(options) {
  Object.assign(signalling, options);
}

const TURN_KEY = "pingpong3d.turn";

/** A relay the player supplied themselves, or null. */
export function loadTurn() {
  try {
    const raw = localStorage.getItem(TURN_KEY);
    const turn = raw ? JSON.parse(raw) : null;
    return turn && turn.urls ? turn : null;
  } catch {
    return null;
  }
}

export function saveTurn(turn) {
  try {
    if (turn && turn.urls) localStorage.setItem(TURN_KEY, JSON.stringify(turn));
    else localStorage.removeItem(TURN_KEY);
  } catch {
    /* private mode */
  }
}

/**
 * A relay can also travel in the link you send your friend:
 * ...?turn=turn:host:3478&turnuser=NAME&turnpass=SECRET
 * so both sides end up on the same relay from one shared URL.
 */
export function turnFromUrl(search) {
  const q = new URLSearchParams(search || "");
  const urls = q.get("turn");
  if (!urls) return null;
  return {
    urls,
    username: q.get("turnuser") || "",
    credential: q.get("turnpass") || "",
  };
}

/** The player's own relay first, then the best-effort public ones. */
export function iceServers() {
  const own = loadTurn();
  return own ? [own, ...ICE_SERVERS] : ICE_SERVERS;
}

function peerOptions() {
  return {
    ...signalling,
    config: { ...BASE_CONFIG, iceServers: iceServers() },
  };
}

/**
 * Record which kinds of ICE candidate we managed to gather. If no `relay`
 * candidate ever appears, no TURN server answered — which is the
 * difference between "your networks blocked a direct path" and "even a
 * relay couldn't help", and the difference matters to the player.
 */
function watchCandidates(conn, seen) {
  let tries = 0;
  const attach = () => {
    const pc = conn.peerConnection;
    if (!pc) {
      if (tries++ < 60) setTimeout(attach, 50);
      return;
    }
    pc.addEventListener("icecandidate", (e) => {
      const found = /\btyp (\w+)/.exec(e.candidate?.candidate || "");
      if (found) seen.add(found[1]);
    });
  };
  attach();
}

/**
 * The message for a failed attempt. PeerJS errors are Error subclasses
 * carrying a `type`, so code that tests `instanceof Error` and passes them
 * through leaks raw internals like "Negotiation of connection to
 * pingpong3d-XXXX failed." Anything with a type gets translated; only our
 * own plain Errors keep their message.
 */
export function failureMessage(err, candidates = new Set()) {
  const type = err?.type;
  if (type === "negotiation-failed" || type === "webrtc") {
    return pathFailure(candidates);
  }
  if (type) return describeError(err);
  return err?.message || String(err);
}

/** Why a connection that reached negotiation still failed. */
function pathFailure(seen) {
  if (!seen.has("relay")) {
    return "Couldn't connect. No relay server answered, so this needed a direct path between your networks and one of them blocked it — usual on mobile data, work or campus Wi-Fi, and VPNs. Put both devices on the same Wi-Fi, or add your own relay under Advanced.";
  }
  return "Couldn't connect even through a relay. One of the two networks is blocking peer-to-peer traffic outright. Try a different network, or both devices on the same Wi-Fi.";
}

/** Signalling errors that make a room unusable; everything else is transient. */
const FATAL = new Set([
  "unavailable-id",
  "invalid-id",
  "invalid-key",
  "browser-incompatible",
  "ssl-unavailable",
  "server-error",
]);

/** Turn a PeerJS error into something a player can act on. */
export function describeError(e) {
  switch (e?.type) {
    case "peer-unavailable":
      return "No room with that code. Check the code, and that your friend still has the page open.";
    case "unavailable-id":
      return "That room code is already in use — create another room.";
    case "browser-incompatible":
      return "This browser can't do peer-to-peer play. Try Chrome, Edge, Firefox or Safari.";
    case "negotiation-failed":
    case "webrtc":
      return "Found the room, but your two networks wouldn't connect. Peer-to-peer is often blocked on mobile data, work Wi-Fi or a VPN — try again, or put both devices on the same Wi-Fi.";
    case "network":
    case "socket-error":
    case "socket-closed":
    case "server-error":
      return "Couldn't reach the matchmaking server. Check your connection and try again.";
    case "disconnected":
      return "Disconnected from the matchmaking server.";
    default:
      return e?.message || "Connection failed. Try again.";
  }
}

/** How long a join attempt may spend on signalling and ICE. */
const JOIN_TIMEOUT = 25000;

/** Readable room codes: no 0/O/1/I ambiguity. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function makeRoomCode(rng = Math.random, length = 6) {
  let code = "";
  for (let i = 0; i < length; i++) code += ALPHABET[Math.floor(rng() * ALPHABET.length)];
  return code;
}
/** PeerJS ids are namespaced so a code can't collide with strangers' rooms. */
export const peerIdFor = (code) => `pingpong3d-${code.toUpperCase()}`;

function makeEnd() {
  const handlers = { message: [], close: [] };
  return {
    handlers,
    onMessage(cb) { handlers.message.push(cb); },
    onClose(cb) { handlers.close.push(cb); },
    emitMessage(msg) { for (const cb of handlers.message) cb(msg); },
    emitClose(reason) { for (const cb of handlers.close) cb(reason); },
  };
}

/**
 * Two connected transports in one process. Messages are queued and
 * delivered by flush(now) (tests drive time explicitly) — or, with
 * `auto: true`, on a timer with the given latency.
 */
export function createLoopbackPair({ latency = 0, loss = 0, rng = Math.random, auto = false } = {}) {
  const queues = [[], []];
  let open = true;
  const ends = [makeEnd(), makeEnd()];
  const build = (i) => {
    const me = ends[i];
    const peer = ends[1 - i];
    const t = {
      send(msg) {
        if (!open) return;
        if (loss > 0 && rng() < loss) return;
        const packet = { at: latency, msg: JSON.parse(JSON.stringify(msg)) };
        queues[1 - i].push(packet);
        if (auto) setTimeout(() => t.flush(Infinity, 1 - i), latency);
      },
      onMessage: me.onMessage,
      onClose: me.onClose,
      close(reason = "closed") {
        if (!open) return;
        open = false;
        me.emitClose(reason);
        peer.emitClose("peer-closed");
      },
      /** Deliver queued packets to end `target` whose latency has elapsed. */
      flush(elapsed = Infinity, target = 1 - i) {
        const q = queues[target];
        const keep = [];
        for (const p of q) {
          if (p.at <= elapsed) ends[target].emitMessage(p.msg);
          else keep.push(p);
        }
        queues[target] = keep;
      },
      get isOpen() { return open; },
    };
    return t;
  };
  const a = build(0);
  const b = build(1);
  /** Deliver everything in both directions, including replies to replies. */
  const flushAll = () => {
    for (let i = 0; i < 8 && (queues[0].length || queues[1].length); i++) {
      a.flush(Infinity, 1);
      b.flush(Infinity, 0);
    }
  };
  return { a, b, flushAll };
}

/**
 * PeerJS-backed transport. `peerjs` is loaded lazily so the offline game
 * never pays for it. Host: createPeerHost(code) resolves once a guest
 * connects. Guest: createPeerGuest(code) resolves once connected.
 */
async function loadPeer() {
  const mod = await import("peerjs");
  return mod.Peer ?? mod.default;
}

function wrapConnection(conn, peer) {
  const end = makeEnd();
  let open = true;
  conn.on("data", (data) => end.emitMessage(data));
  conn.on("close", () => { if (open) { open = false; end.emitClose("peer-closed"); } });
  conn.on("error", (e) => { if (open) { open = false; end.emitClose(String(e?.message || e)); } });
  peer.on("disconnected", () => { /* signalling only; data channel keeps working */ });
  return {
    send(msg) { if (open && conn.open) conn.send(msg); },
    onMessage: end.onMessage,
    onClose: end.onClose,
    close(reason = "closed") {
      if (!open) return;
      open = false;
      try { conn.close(); } catch { /* ignore */ }
      try { peer.destroy(); } catch { /* ignore */ }
      end.emitClose(reason);
    },
    get isOpen() { return open && conn.open; },
  };
}

export function createPeerHost(code, { onWaiting, onStatus } = {}) {
  return new Promise(async (resolve, reject) => {
    const Peer = await loadPeer();
    const peer = new Peer(peerIdFor(code), peerOptions());
    let settled = false;
    peer.on("open", () => onWaiting?.(code));
    peer.on("connection", (conn) => {
      conn.on("open", () => {
        if (settled) {
          conn.close();
          return;
        }
        settled = true;
        resolve(wrapConnection(conn, peer));
      });
      // A guest that fails to negotiate must not take the room down: report
      // it and keep listening so they (or someone else) can try again.
      conn.on("error", (e) => onStatus?.(describeError(e)));
    });
    // The signalling socket can drop while nobody has joined yet; without
    // this the room quietly stops existing and guests get "no such room".
    peer.on("disconnected", () => {
      if (settled) return;
      try {
        peer.reconnect();
      } catch {
        /* destroyed */
      }
    });
    peer.on("error", (e) => {
      if (settled) return;
      if (!FATAL.has(e?.type)) {
        onStatus?.(describeError(e));
        return;
      }
      settled = true;
      try {
        peer.destroy();
      } catch {
        /* ignore */
      }
      reject(new Error(describeError(e)));
    });
  });
}

export function createPeerGuest(code, { onStatus } = {}) {
  return new Promise(async (resolve, reject) => {
    const Peer = await loadPeer();
    const peer = new Peer(peerOptions());
    let settled = false;
    let timer = 0;
    const candidates = new Set();
    /**
     * PeerJS errors are Error subclasses carrying a `type`, so testing
     * `instanceof Error` and passing them through showed raw internals
     * like "Negotiation of connection to pingpong3d-XXXX failed." Always
     * translate anything that carries a type.
     */
    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        peer.destroy();
      } catch {
        /* ignore */
      }
      reject(new Error(failureMessage(err, candidates)));
    };
    timer = setTimeout(
      () =>
        fail(
          new Error(
            "The room didn't answer in time. Your friend may have closed the page, or the networks can't reach each other."
          )
        ),
      JOIN_TIMEOUT
    );
    peer.on("open", () => {
      onStatus?.("Reaching the room…");
      // Reliable and ordered: point and game-over events travel on this
      // channel, and a dropped one would desync the score for good.
      const conn = peer.connect(peerIdFor(code), { serialization: "json" });
      watchCandidates(conn, candidates);
      conn.on("open", () => {
        settled = true;
        clearTimeout(timer);
        resolve(wrapConnection(conn, peer));
      });
      conn.on("iceStateChanged", (state) => {
        if (state === "checking") onStatus?.("Finding a route…");
        if (state === "connected" || state === "completed") onStatus?.("Connected");
      });
      conn.on("error", (e) => fail(e));
    });
    peer.on("error", (e) => fail(e));
  });
}
