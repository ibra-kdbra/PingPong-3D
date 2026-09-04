/**
 * Message transports for online play.
 *
 * A transport is { send(msg), onMessage(cb), onClose(cb), close() } carrying
 * JSON-serialisable objects. Two implementations:
 *  - PeerJS (WebRTC DataChannel, brokered by PeerJS' signalling server)
 *  - Loopback pair: two in-process ends with optional simulated latency and
 *    loss, for tests and local demos.
 */

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

export function createPeerHost(code, { onWaiting } = {}) {
  return new Promise(async (resolve, reject) => {
    const Peer = await loadPeer();
    const peer = new Peer(peerIdFor(code));
    let settled = false;
    peer.on("open", () => onWaiting?.(code));
    peer.on("connection", (conn) => {
      conn.on("open", () => {
        if (settled) { conn.close(); return; }
        settled = true;
        resolve(wrapConnection(conn, peer));
      });
    });
    peer.on("error", (e) => {
      if (settled) return;
      settled = true;
      try { peer.destroy(); } catch { /* ignore */ }
      reject(new Error(e?.type === "unavailable-id" ? "That room code is taken — try again." : `Connection failed (${e?.type || "error"}).`));
    });
  });
}

export function createPeerGuest(code) {
  return new Promise(async (resolve, reject) => {
    const Peer = await loadPeer();
    const peer = new Peer();
    let settled = false;
    peer.on("open", () => {
      const conn = peer.connect(peerIdFor(code), { reliable: false, serialization: "json" });
      conn.on("open", () => { settled = true; resolve(wrapConnection(conn, peer)); });
      conn.on("error", (e) => { if (!settled) { settled = true; reject(new Error(String(e?.message || e))); } });
      setTimeout(() => {
        if (!settled) { settled = true; try { peer.destroy(); } catch { /* ignore */ } reject(new Error("No room with that code answered.")); }
      }, 12000);
    });
    peer.on("error", (e) => {
      if (settled) return;
      settled = true;
      try { peer.destroy(); } catch { /* ignore */ }
      reject(new Error(e?.type === "peer-unavailable" ? "No room with that code." : `Connection failed (${e?.type || "error"}).`));
    });
  });
}
