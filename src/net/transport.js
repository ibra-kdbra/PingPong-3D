/**
 * Message transports for online play.
 *
 * A transport is { send(msg), onMessage(cb), onClose(cb), close() } carrying
 * JSON-serialisable objects. Two implementations:
 *  - PeerJS (WebRTC DataChannel, brokered by PeerJS' signalling server)
 *  - Loopback pair: two in-process ends with optional simulated latency and
 *    loss, for tests and local demos.
 */
import {
  ICE_SERVERS,
  PUBLIC_TURN,
  STUN_SERVERS,
  iceServersSync,
  loadEndpoint,
  loadTurn,
  resolveIce,
  saveEndpoint,
  saveTurn,
  turnFromUrl,
  endpointFromUrl,
  probeRelay,
} from "./ice.js";

export {
  ICE_SERVERS,
  PUBLIC_TURN,
  STUN_SERVERS,
  loadTurn,
  saveTurn,
  loadEndpoint,
  saveEndpoint,
  turnFromUrl,
  endpointFromUrl,
  probeRelay,
  resolveIce,
};

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

/** The synchronous view, for callers that can't await (kept for tests). */
export function iceServers() {
  return iceServersSync();
}

/**
 * PeerJS options. Resolving ICE can involve a network round trip to a
 * credentials provider, so this is async; a provider that is slow or down
 * degrades to the built-in list rather than blocking the connection.
 */
async function peerOptions({ relayOnly = false } = {}) {
  const iceServers = await resolveIce();
  const config = { ...BASE_CONFIG, iceServers };
  // Forcing relay-only discards direct paths entirely. Used for the second
  // attempt: if a direct path were going to work it already would have,
  // and a half-working srflx pair can otherwise win the nomination and
  // then blackhole.
  if (relayOnly) config.iceTransportPolicy = "relay";
  return { ...signalling, config };
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
    // addEventListener, not onicecandidate: PeerJS owns that property and
    // clears it when gathering completes.
    pc.addEventListener("icecandidate", (e) => {
      const found = /\btyp (\w+)/.exec(e.candidate?.candidate || "");
      if (found) seen.add(found[1]);
    });
    pc.addEventListener("icecandidateerror", (e) => {
      if (e.errorCode === 401 || e.errorCode === 403) seen.add("relay-rejected");
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
  if (seen.has("relay-rejected")) {
    return "Couldn't connect. The relay server refused the credentials it was given — if you set one up under Advanced, check the username and password.";
  }
  if (!seen.has("relay")) {
    return "Couldn't connect. No relay server answered, so this needed a direct path between your networks and one of them blocked it — usual on mobile data, work or campus Wi-Fi, and VPNs. Add a relay under Advanced, or put both devices on the same Wi-Fi.";
  }
  return "Couldn't connect even through a relay. One of the two networks is blocking peer-to-peer traffic outright. Try a different network, or both devices on the same Wi-Fi.";
}

/** Signalling errors that make a room unusable; everything else is transient. */
const FATAL = new Set([
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

/**
 * How long one join attempt may spend on signalling and ICE. Two attempts
 * are made (direct, then relay-only), so this is half the patience the
 * player actually gets.
 */
const ATTEMPT_TIMEOUT = 15000;
/** How many fresh room codes the host will try if the broker says "taken". */
const CODE_RETRIES = 3;

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

/**
 * Data channel options. `reliable: true` is not optional for this game:
 * PeerJS builds the channel as `{ ordered: !!options.reliable }`, so
 * leaving it out gives an *unordered* channel. Snapshots carry the score
 * and phase, so a snapshot overtaking a newer one visibly rewinds the
 * game. (The session layer also drops stale snapshots, because a protocol
 * should not depend on the transport being well behaved.)
 */
const CHANNEL = { serialization: "json", reliable: true };

function wrapConnection(conn, peer) {
  const end = makeEnd();
  let open = true;
  // A closed tab never sends a clean goodbye, so the peer would sit out
  // the whole heartbeat timeout wondering. One line takes that from about
  // five seconds to about a tenth of one.
  const bye = () => { try { conn.close(); } catch { /* ignore */ } };
  const unbind = () => {
    if (typeof removeEventListener === "function") removeEventListener("pagehide", bye);
  };
  if (typeof addEventListener === "function") addEventListener("pagehide", bye);

  const shut = (reason) => {
    if (!open) return;
    open = false;
    unbind();
    end.emitClose(reason);
  };
  conn.on("data", (data) => end.emitMessage(data));
  conn.on("close", () => shut("peer-closed"));
  conn.on("error", (e) => shut(failureMessage(e)));
  // Errors raised on the peer after the match has started used to go
  // nowhere. Only act on them once the data channel itself is gone: the
  // peer object also reports things that have nothing to do with this
  // match (a second guest knocking, the signalling socket dropping), and
  // ending a live game over one of those would be worse than ignoring it.
  peer.on("error", (e) => {
    if (conn.open) return;
    shut(failureMessage(e));
  });
  peer.on("disconnected", () => { /* signalling only; data channel keeps working */ });

  return {
    send(msg) { if (open && conn.open) conn.send(msg); },
    onMessage: end.onMessage,
    onClose: end.onClose,
    close(reason = "closed") {
      if (!open) return;
      open = false;
      unbind();
      try { conn.close(); } catch { /* ignore */ }
      try { peer.destroy(); } catch { /* ignore */ }
      end.emitClose(reason);
    },
    get isOpen() { return open && conn.open; },
  };
}

/**
 * Open a room and wait for a guest.
 *
 * `onCode` fires whenever the room code changes — the broker can report a
 * code as taken (a ghost room left by a crashed tab keeps an id alive for
 * a while), and silently picking a new one would leave the player reading
 * a code nobody can join.
 */
export async function createPeerHost(code, { onWaiting, onStatus, onCode } = {}) {
  const Peer = await loadPeer();
  const options = await peerOptions();
  let current = code;

  for (let attempt = 0; ; attempt++) {
    try {
      return await openRoom(Peer, options, current, { onWaiting, onStatus });
    } catch (e) {
      if (e?.type !== "unavailable-id" || attempt >= CODE_RETRIES) {
        throw new Error(failureMessage(e));
      }
      current = makeRoomCode();
      onCode?.(current);
      onStatus?.("That code was taken — opening another room…");
    }
  }
}

function openRoom(Peer, options, code, { onWaiting, onStatus }) {
  return new Promise((resolve, reject) => {
    const peer = new Peer(peerIdFor(code), options);
    const candidates = new Set();
    let settled = false;
    const give = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    peer.on("open", () => onWaiting?.(code));
    peer.on("connection", (conn) => {
      watchCandidates(conn, candidates);
      conn.on("open", () => {
        if (settled) {
          conn.close();
          return;
        }
        settled = true;
        resolve(wrapConnection(conn, peer));
      });
      // A guest that fails to negotiate must not take the room down:
      // report it and keep listening so they can try again.
      conn.on("error", (e) => {
        if (!settled) onStatus?.(failureMessage(e, candidates));
      });
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
      // `unavailable-id` is recoverable by the caller with a fresh code,
      // so it is rejected raw rather than as prose.
      if (e?.type === "unavailable-id") {
        try {
          peer.destroy();
        } catch {
          /* ignore */
        }
        give(reject, e);
        return;
      }
      if (!FATAL.has(e?.type)) {
        onStatus?.(describeError(e));
        return;
      }
      try {
        peer.destroy();
      } catch {
        /* ignore */
      }
      give(reject, e);
    });
  });
}

/**
 * Join a room. Two attempts: the normal one, then — if that failed on the
 * network rather than on the room being absent — a relay-only retry.
 * Forcing relay is worth a second attempt because the common failure is
 * not "no path exists" but "the browser picked a path that doesn't work".
 */
export async function createPeerGuest(code, { onStatus } = {}) {
  const Peer = await loadPeer();
  const direct = await peerOptions();
  try {
    return await joinRoom(Peer, direct, code, { onStatus });
  } catch (first) {
    // No point relaying if the room isn't there, or if the browser can't
    // do this at all.
    if (first.fatal || !hasRelay(direct)) throw new Error(first.message);
    onStatus?.("Retrying through a relay…");
    const relayed = await peerOptions({ relayOnly: true });
    try {
      return await joinRoom(Peer, relayed, code, { onStatus });
    } catch (second) {
      throw new Error(second.message || first.message);
    }
  }
}

const hasRelay = (options) =>
  (options.config?.iceServers || []).some((s) =>
    (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => String(u).startsWith("turn"))
  );

/** Errors that a relay retry cannot possibly fix. */
const NO_RETRY = new Set(["peer-unavailable", "browser-incompatible", "invalid-id", "invalid-key"]);

function joinRoom(Peer, options, code, { onStatus }) {
  return new Promise((resolve, reject) => {
    const peer = new Peer(options);
    const candidates = new Set();
    let settled = false;
    let timer = 0;
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
      reject({ message: failureMessage(err, candidates), fatal: NO_RETRY.has(err?.type) });
    };
    timer = setTimeout(
      () =>
        fail(
          new Error(
            "The room didn't answer in time. Your friend may have closed the page, or the networks can't reach each other."
          )
        ),
      ATTEMPT_TIMEOUT
    );
    peer.on("open", () => {
      onStatus?.("Reaching the room…");
      const conn = peer.connect(peerIdFor(code), CHANNEL);
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
