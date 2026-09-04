import { test } from "node:test";
import assert from "node:assert/strict";
import { createMatch } from "../src/game/match.js";
import {
  createLoopbackPair,
  makeRoomCode,
  peerIdFor,
  describeError,
  ICE_SERVERS,
} from "../src/net/transport.js";
import { createHost, createGuest, PROTOCOL_VERSION } from "../src/net/session.js";

const STEP = 1 / 120;
const idle = () => ({ p1x: 0, p1vx: 0, p1aim: 0, p1spin: 0, p1tech: 0, p2x: 0, p2vx: 0, p2aim: 0, p2spin: 0, p2tech: 0 });

function clock() {
  let t = 0;
  return { now: () => t, advance: (dt) => { t += dt; } };
}

function setup({ latency = 0 } = {}) {
  const c = clock();
  const { a, b, flushAll } = createLoopbackPair({ latency });
  const match = createMatch({ rng: () => 0.5 });
  const host = createHost({ transport: a, match, name: "Ann", now: c.now });
  const guest = createGuest({ transport: b, name: "Bob", now: c.now });
  flushAll(); // hello → welcome
  return { c, a, b, flushAll, match, host, guest };
}

test("room codes are readable and namespaced", () => {
  const code = makeRoomCode(() => 0.999);
  assert.equal(code.length, 6);
  assert.ok(!/[01OI]/.test(code));
  assert.equal(peerIdFor("abc123"), "pingpong3d-ABC123");
});

test("handshake exchanges names and the match config", () => {
  const { host, guest } = setup();
  assert.equal(host.state.connected, true);
  assert.equal(guest.state.connected, true);
  assert.equal(host.state.peerName, "Bob");
  assert.equal(guest.state.peerName, "Ann");
  assert.equal(guest.state.cfg.winScore, 7);
  assert.equal(typeof guest.state.cfg.gravity, "number");
});

test("a version mismatch is refused cleanly", () => {
  const c = clock();
  const { a, b, flushAll } = createLoopbackPair();
  const match = createMatch({ rng: () => 0.5 });
  const host = createHost({ transport: a, match, now: c.now });
  let hostErr = null;
  host.on((type, data) => { if (type === "error") hostErr = data; });
  b.send({ t: "hello", v: PROTOCOL_VERSION + 1, name: "Old" });
  flushAll();
  assert.ok(hostErr, "host reports the mismatch");
  assert.equal(host.state.connected, false);
});

test("guest input drives player 2 on the host", () => {
  const { host, guest, flushAll } = setup();
  guest.sendInput(-3.2, 4, 0.5, -1, 2);
  flushAll();
  const input = idle();
  host.applyRemoteInput(input);
  assert.equal(input.p2x, -3.2);
  assert.equal(input.p2vx, 4);
  assert.equal(input.p2aim, 0.5);
  assert.equal(input.p2spin, -1);
  assert.equal(input.p2tech, 2);
  // stale (lower seq) packets never overwrite newer ones
  guest.sendInput(1, 0, 0, 0, 0);
  guest.sendInput(2, 0, 0, 0, 0);
  flushAll();
  host.applyRemoteInput(input);
  assert.equal(input.p2x, 2);
});

test("snapshots and events reach the guest and the shadow follows the ball", () => {
  const { c, host, guest, match, flushAll } = setup();
  const input = idle();
  const events = new Array(16);
  const seen = new Set();
  // Run ~2 seconds: serve launches, the ball flies and bounces.
  for (let i = 0; i < 240; i++) {
    host.applyRemoteInput(input);
    match.step(STEP, input);
    const n = match.drainEvents(events);
    host.afterStep(events, n);
    c.advance(STEP);
    flushAll();
    guest.update(STEP);
    const g = new Array(16);
    const m = guest.drainEvents(g);
    for (let j = 0; j < m; j++) seen.add(g[j].type);
  }
  assert.ok(seen.has("serve"), "serve event forwarded");
  assert.ok(seen.has("bounce"), "bounce event forwarded");
  assert.equal(guest.state.phase, match.state.phase);
  const gb = guest.shadow.ball;
  const hb = match.state.ball;
  assert.ok(Math.hypot(gb.x - hb.x, gb.y - hb.y, gb.z - hb.z) < 0.6, "shadow tracks the host ball");
});

test("the shadow stays smooth under 120 ms latency", () => {
  const { c, host, guest, match, flushAll } = setup({ latency: 0.12 });
  const input = idle();
  const events = new Array(16);
  let maxJump = 0;
  let prev = null;
  for (let i = 0; i < 300; i++) {
    host.applyRemoteInput(input);
    match.step(STEP, input);
    const n = match.drainEvents(events);
    host.afterStep(events, n);
    c.advance(STEP);
    // deliver only packets older than the latency
    // (loopback delivers when elapsed >= at; we emulate by flushing all
    // every 120ms worth of steps)
    if (i % 14 === 0) flushAll();
    guest.update(STEP);
    const b = guest.shadow.ball;
    if (prev && match.state.phase === "rally" && i > 40) {
      const jump = Math.hypot(b.x - prev.x, b.y - prev.y, b.z - prev.z);
      if (jump > maxJump) maxJump = jump;
    }
    prev = { x: b.x, y: b.y, z: b.z };
  }
  // a 30 u/s ball moves 0.25 per 120 Hz step; anything much larger is a snap
  assert.ok(maxJump < 0.9, `largest per-frame shadow jump ${maxJump.toFixed(2)}`);
});

test("rematch is a two-way handshake; the host restarts both sides", () => {
  const { host, guest, flushAll } = setup();
  let hostRematch = null;
  host.on((type, data) => { if (type === "rematch") hostRematch = { ...data }; });
  guest.requestRematch();
  flushAll();
  assert.equal(host.state.rematch.them, true);
  assert.equal(host.state.rematch.me, false);
  host.requestRematch();
  flushAll();
  assert.equal(guest.state.rematch.them, true);
  assert.deepEqual(hostRematch, { me: true, them: true });
  let restarted = false;
  guest.on((type) => { if (type === "restart") restarted = true; });
  host.restart(createMatch({ rng: () => 0.5, winScore: 11 }));
  flushAll();
  assert.equal(restarted, true);
  assert.equal(guest.state.cfg.winScore, 11);
  assert.deepEqual(guest.state.rematch, { me: false, them: false });
});

test("leaving closes both ends with a reason", () => {
  const { host, guest, flushAll } = setup();
  let hostClosed = null;
  let guestClosed = null;
  host.on((type, why) => { if (type === "closed") hostClosed = why; });
  guest.on((type, why) => { if (type === "closed") guestClosed = why; });
  guest.leave();
  flushAll();
  assert.ok(hostClosed, "host sees the disconnect");
  assert.ok(guestClosed, "guest side closed too");
  assert.equal(host.state.connected, false);
});

test("pause is mirrored to the guest", () => {
  const { host, guest, flushAll } = setup();
  host.setPaused(true);
  flushAll();
  assert.equal(guest.state.paused, true);
  host.setPaused(false);
  flushAll();
  assert.equal(guest.state.paused, false);
});

test("connection failures are explained in terms a player can act on", () => {
  // The room simply is not there.
  assert.match(describeError({ type: "peer-unavailable" }), /No room with that code/);
  // Signalling worked but ICE could not find a path — the case that says
  // "Negotiation of connection ... failed" in PeerJS.
  const blocked = describeError({ type: "negotiation-failed" });
  assert.match(blocked, /networks wouldn't connect/);
  assert.match(blocked, /same Wi-Fi/);
  assert.match(describeError({ type: "unavailable-id" }), /already in use/);
  assert.match(describeError({ type: "network" }), /matchmaking server/);
  assert.match(describeError({ type: "browser-incompatible" }), /browser/);
  // Anything unrecognised still says something, never "[object Object]".
  assert.equal(describeError({ message: "boom" }), "boom");
  assert.match(describeError({}), /Try again/);
});

test("ICE configuration offers STUN plus more than one TURN relay", () => {
  const urls = ICE_SERVERS.flatMap((s) => [].concat(s.urls));
  assert.ok(urls.some((u) => u.startsWith("stun:")), "has STUN");
  const turnHosts = new Set(
    urls.filter((u) => u.startsWith("turn")).map((u) => u.split(":")[1])
  );
  assert.ok(turnHosts.size >= 2, `relays on ${turnHosts.size} hosts`);
  // A TLS/443 relay is what gets through networks that only allow HTTPS.
  assert.ok(urls.some((u) => u.includes(":443")), "has a 443 relay");
  for (const server of ICE_SERVERS) {
    if ([].concat(server.urls).some((u) => u.startsWith("turn"))) {
      assert.ok(server.username && server.credential, "TURN needs credentials");
    }
  }
});
