/**
 * Online session logic (pure JS, transport-agnostic, unit-tested).
 *
 * Host-authoritative: the host runs the real match engine, applies the
 * guest's inputs to player 2, and streams snapshots (30 Hz) plus events.
 * The guest keeps a "shadow" of the ball and paddles that it integrates
 * locally between snapshots and eases toward each new one, so the ball
 * moves smoothly even on a jittery link. Events (hits, points, game over)
 * are authoritative and reach both sides identically.
 *
 * All positions on the wire are world coordinates. The guest mirrors its
 * own pointer before sending (its right is world -x) and renders the
 * scene rotated 180°, so both players see themselves at the bottom.
 */
import { GRAVITY, TABLE, BALL_RADIUS } from "../game/match.js";

export const PROTOCOL_VERSION = 2;
const SNAPSHOT_INTERVAL = 1 / 30;
const PING_INTERVAL = 2;
const MAGNUS = 0.5;
const DIP = 0.35;

const EVENT_TYPES = ["serve", "hit", "bounce", "net", "netcord", "point", "over"];
const evIndex = (t) => EVENT_TYPES.indexOf(t);

export function createHost({ transport, match, name = "Host", now = () => performance.now() / 1000 }) {
  const state = {
    connected: false,
    peerName: "",
    latency: 0,
    rematch: { me: false, them: false },
    error: null,
  };
  const listeners = [];
  const emit = (type, data) => listeners.forEach((cb) => cb(type, data));
  const remote = { x: 0, vx: 0, aim: 0, spin: 0, tech: 0, seq: -1, at: 0 };
  let nextSnap = 0;
  let nextPing = 0;
  let current = match;

  transport.onMessage((m) => {
    switch (m.t) {
      case "hello":
        if (m.v !== PROTOCOL_VERSION) {
          transport.send({ t: "bye", why: "version" });
          state.error = "Your friend is running a different version of the game.";
          emit("error", state.error);
          transport.close("version");
          return;
        }
        state.connected = true;
        state.peerName = String(m.name || "Guest").slice(0, 16);
        transport.send({
          t: "welcome",
          v: PROTOCOL_VERSION,
          name,
          cfg: current.state.config,
        });
        emit("joined", state.peerName);
        break;
      case "input":
        if (m.seq > remote.seq) {
          remote.seq = m.seq;
          remote.x = +m.x || 0;
          remote.vx = +m.vx || 0;
          remote.aim = Math.max(-1, Math.min(1, +m.aim || 0));
          remote.spin = Math.max(-1, Math.min(1, +m.spin || 0));
          remote.tech = m.tech | 0;
          remote.at = now();
        }
        break;
      case "ping":
        transport.send({ t: "pong", ts: m.ts });
        break;
      case "pong":
        state.latency = Math.max(0, (now() - m.ts) / 2);
        break;
      case "rematch":
        state.rematch.them = true;
        emit("rematch", state.rematch);
        break;
      case "leave":
        transport.close("peer-left");
        break;
    }
  });
  transport.onClose((why) => {
    state.connected = false;
    emit("closed", why);
  });

  return {
    state,
    on(cb) { listeners.push(cb); },
    /** Copy the guest's latest input into the engine input for player 2. */
    applyRemoteInput(input) {
      input.p2x = remote.x;
      input.p2vx = remote.vx;
      input.p2aim = remote.aim;
      input.p2spin = remote.spin;
      input.p2tech = remote.tech;
    },
    /** Called every frame after stepping: streams snapshots, events, pings. */
    afterStep(events, count) {
      const t = now();
      if (count > 0) {
        const list = [];
        for (let i = 0; i < count; i++) {
          const e = events[i];
          list.push([evIndex(e.type), e.a, e.b, e.c || 0]);
        }
        transport.send({ t: "ev", list });
      }
      if (t >= nextSnap) {
        nextSnap = t + SNAPSHOT_INTERVAL;
        const s = current.state;
        const b = s.ball;
        transport.send({
          t: "snap",
          ts: t,
          ball: [b.x, b.y, b.z, b.vx, b.vy, b.vz, b.sx, b.ts],
          p: [s.paddles[0].x, s.paddles[0].vx, s.paddles[1].x, s.paddles[1].vx],
          ph: s.phase,
          srv: s.server,
          sc: [s.scores[0], s.scores[1]],
          rally: s.rallyHits,
        });
      }
      if (t >= nextPing) {
        nextPing = t + PING_INTERVAL;
        transport.send({ t: "ping", ts: t });
      }
    },
    /** Swap in a fresh engine (rematch) and tell the guest. */
    restart(newMatch) {
      current = newMatch;
      state.rematch.me = false;
      state.rematch.them = false;
      transport.send({ t: "restart", cfg: current.state.config });
    },
    requestRematch() {
      state.rematch.me = true;
      transport.send({ t: "rematch" });
      emit("rematch", state.rematch);
    },
    /** Send the pause state so the guest freezes too. */
    setPaused(paused) {
      transport.send({ t: "pause", on: !!paused });
    },
    leave() {
      transport.send({ t: "leave" });
      transport.close("left");
    },
  };
}

export function createGuest({ transport, name = "Guest", now = () => performance.now() / 1000 }) {
  const state = {
    connected: false,
    peerName: "",
    latency: 0,
    phase: "serve",
    server: 1,
    scores: [0, 0],
    rally: 0,
    paused: false,
    cfg: { gravity: GRAVITY, netHeight: TABLE.NET_HEIGHT, wind: 0, restitution: 0.82, winScore: 7 },
    rematch: { me: false, them: false },
    error: null,
  };
  /** What the guest renders; eased toward the host's truth. */
  const shadow = {
    ball: { x: 0, y: 2, z: TABLE.PADDLE_Z, vx: 0, vy: 0, vz: 0, sx: 0, ts: 0 },
    paddles: [
      { x: 0, z: TABLE.PADDLE_Z, vx: 0 },
      { x: 0, z: -TABLE.PADDLE_Z, vx: 0 },
    ],
  };
  const target = { ball: { ...shadow.ball }, paddles: [{ x: 0, vx: 0 }, { x: 0, vx: 0 }], has: false };
  const events = [];
  const listeners = [];
  const emit = (type, data) => listeners.forEach((cb) => cb(type, data));
  let seq = 0;
  let nextPing = 0;

  transport.onMessage((m) => {
    switch (m.t) {
      case "welcome":
        state.connected = true;
        state.peerName = String(m.name || "Host").slice(0, 16);
        if (m.cfg) state.cfg = { ...state.cfg, ...m.cfg };
        emit("joined", state.peerName);
        break;
      case "bye":
        state.error = m.why === "version" ? "Your friend is running a different version of the game." : "The host ended the game.";
        emit("error", state.error);
        break;
      case "snap": {
        const b = m.ball;
        Object.assign(target.ball, { x: b[0], y: b[1], z: b[2], vx: b[3], vy: b[4], vz: b[5], sx: b[6], ts: b[7] });
        target.paddles[0].x = m.p[0];
        target.paddles[0].vx = m.p[1];
        target.paddles[1].x = m.p[2];
        target.paddles[1].vx = m.p[3];
        if (!target.has) {
          Object.assign(shadow.ball, target.ball);
          target.has = true;
        }
        state.phase = m.ph;
        state.server = m.srv;
        state.scores[0] = m.sc[0];
        state.scores[1] = m.sc[1];
        state.rally = m.rally;
        break;
      }
      case "ev":
        for (const [ti, a, b, c] of m.list) {
          const type = EVENT_TYPES[ti];
          if (type) events.push({ type, a, b, c });
        }
        break;
      case "ping":
        transport.send({ t: "pong", ts: m.ts });
        break;
      case "pong":
        state.latency = Math.max(0, (now() - m.ts) / 2);
        break;
      case "rematch":
        state.rematch.them = true;
        emit("rematch", state.rematch);
        break;
      case "restart":
        state.rematch.me = false;
        state.rematch.them = false;
        state.scores[0] = 0;
        state.scores[1] = 0;
        state.phase = "serve";
        state.rally = 0;
        if (m.cfg) state.cfg = { ...state.cfg, ...m.cfg };
        target.has = false;
        emit("restart");
        break;
      case "pause":
        state.paused = !!m.on;
        emit("pause", state.paused);
        break;
      case "leave":
        transport.close("peer-left");
        break;
    }
  });
  transport.onClose((why) => {
    state.connected = false;
    emit("closed", why);
  });

  transport.send({ t: "hello", v: PROTOCOL_VERSION, name });

  const integrate = (b, dt) => {
    if (state.phase !== "rally" || state.paused) return;
    const g = state.cfg.gravity - DIP * Math.max(b.ts, 0) * Math.abs(b.vz);
    b.vy += g * dt;
    b.vx += (MAGNUS * b.sx * Math.abs(b.vz) + state.cfg.wind) * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    // Local table bounce (same rule as the engine) so the shadow never
    // dives through the table while waiting for the next snapshot.
    if (
      b.vy < 0 &&
      b.y <= BALL_RADIUS &&
      Math.abs(b.x) <= TABLE.WIDTH / 2 + BALL_RADIUS &&
      Math.abs(b.z) <= TABLE.LENGTH / 2 + BALL_RADIUS
    ) {
      b.y = BALL_RADIUS;
      b.vy = -b.vy * state.cfg.restitution * (1 - 0.18 * b.ts);
      b.vz *= 0.985 * (1 + 0.14 * b.ts);
      b.vx *= 0.97;
      b.ts *= 0.45;
      b.sx *= 0.6;
    }
  };

  return {
    state,
    shadow,
    on(cb) { listeners.push(cb); },
    /** Send this frame's input (world coordinates). */
    sendInput(x, vx, aim, spin, tech) {
      transport.send({ t: "input", seq: seq++, x, vx, aim, spin, tech });
      const t = now();
      if (t >= nextPing) {
        nextPing = t + PING_INTERVAL;
        transport.send({ t: "ping", ts: t });
      }
    },
    /** Advance the shadow: integrate locally, ease toward the host. */
    update(dt) {
      if (!target.has) return;
      integrate(target.ball, dt);
      integrate(shadow.ball, dt);
      const k = Math.min(1, dt * 14);
      const s = shadow.ball;
      const tb = target.ball;
      // Big jumps (serve reset, point) snap; small drift eases.
      const far = Math.hypot(tb.x - s.x, tb.y - s.y, tb.z - s.z) > 2.5;
      const w = far ? 1 : k;
      s.x += (tb.x - s.x) * w;
      s.y += (tb.y - s.y) * w;
      s.z += (tb.z - s.z) * w;
      s.vx = tb.vx;
      s.vy = tb.vy;
      s.vz = tb.vz;
      s.sx = tb.sx;
      s.ts = tb.ts;
      for (let i = 0; i < 2; i++) {
        const p = shadow.paddles[i];
        const tp = target.paddles[i];
        p.x += (tp.x - p.x) * Math.min(1, dt * 18);
        p.vx = tp.vx;
      }
    },
    drainEvents(out) {
      const n = events.length;
      for (let i = 0; i < n; i++) out[i] = events[i];
      events.length = 0;
      return n;
    },
    requestRematch() {
      state.rematch.me = true;
      transport.send({ t: "rematch" });
      emit("rematch", state.rematch);
    },
    leave() {
      transport.send({ t: "leave" });
      transport.close("left");
    },
  };
}
