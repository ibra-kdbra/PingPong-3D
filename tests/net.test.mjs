import { test } from "node:test";
import assert from "node:assert/strict";
import { createMatch } from "../src/game/match.js";
// A localStorage stand-in, so the relay settings can be tested in Node.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const {
  createLoopbackPair,
  makeRoomCode,
  peerIdFor,
  describeError,
  failureMessage,
  ICE_SERVERS,
  iceServers,
  loadTurn,
  saveTurn,
  turnFromUrl,
  loadEndpoint,
  saveEndpoint,
  endpointFromUrl,
  resolveIce,
  probeRelay,
} = await import("../src/net/transport.js");
const { parseIceResponse, fetchIceServers, clearIceCache, candidateErrorText } =
  await import("../src/net/ice.js");
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
  const { c, a, host, guest, match, flushAll } = setup();
  /** Put a raw message on the wire, exactly as the host would. */
  const wire = (msg) => { a.send(msg); flushAll(); };
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

test("a peer that goes silent is reported lost instead of freezing", () => {
  const { c, host, guest, match, flushAll } = setup();
  let hostClosed = null;
  let guestClosed = null;
  host.on((type, why) => { if (type === "closed") hostClosed = why; });
  guest.on((type, why) => { if (type === "closed") guestClosed = why; });

  const events = new Array(16);
  const input = idle();
  // Normal traffic for a second: nobody is lost.
  for (let i = 0; i < 120; i++) {
    host.applyRemoteInput(input);
    match.step(STEP, input);
    host.afterStep(events, match.drainEvents(events));
    guest.sendInput(0, 0, 0, 0, 0);
    c.advance(STEP);
    flushAll();
    guest.update(STEP);
  }
  assert.equal(hostClosed, null, "healthy link stays open");
  assert.equal(guestClosed, null);

  // Now both sides go silent (tab closed, laptop shut, network died):
  // keep stepping locally but deliver nothing in either direction.
  for (let i = 0; i < 120 * 7; i++) {
    host.afterStep(events, 0);
    c.advance(STEP);
    guest.update(STEP);
  }
  // Whichever side's timer trips first tears the link down and the other
  // learns of it through the transport closing — both must end up out.
  assert.ok(hostClosed, `host notices the guest is gone (${hostClosed})`);
  assert.ok(guestClosed, `guest notices the host is gone (${guestClosed})`);
  assert.ok(
    [hostClosed, guestClosed].includes("timeout"),
    "at least one side detected it by silence, not by a clean close"
  );
  assert.equal(host.state.connected, false);
  assert.equal(guest.state.connected, false);
});

/** PeerJS errors are Error subclasses that carry a `type`. */
class FakePeerError extends Error {
  constructor(type, message) {
    super(message);
    this.type = type;
  }
}

test("PeerJS errors are translated, never shown raw", () => {
  // The exact regression: this used to reach the player verbatim because
  // a PeerError passes `instanceof Error`.
  const raw = new FakePeerError(
    "negotiation-failed",
    "Negotiation of connection to pingpong3d-3XC2DE failed."
  );
  const shown = failureMessage(raw);
  assert.ok(!shown.includes("Negotiation of connection"), shown);
  assert.ok(!shown.includes("pingpong3d-"), "no internal peer ids leak");
  assert.match(shown, /Couldn't connect/);

  const missing = new FakePeerError("peer-unavailable", "Could not connect to peer x");
  assert.match(failureMessage(missing), /No room with that code/);

  // Our own errors (the join timeout) keep their wording.
  assert.equal(failureMessage(new Error("The room didn't answer in time.")),
    "The room didn't answer in time.");
});

test("the failure explains whether a relay was even available", () => {
  const err = new FakePeerError("negotiation-failed", "raw");
  const noRelay = failureMessage(err, new Set(["host", "srflx"]));
  assert.match(noRelay, /No relay server answered/);
  assert.match(noRelay, /Advanced/, "points at the setting that fixes it");

  const withRelay = failureMessage(err, new Set(["host", "srflx", "relay"]));
  assert.match(withRelay, /even through a relay/i);
  assert.ok(!withRelay.includes("No relay server answered"));
});

test("a player's own relay is stored and tried first", () => {
  localStorage.clear();
  assert.equal(loadTurn(), null);
  assert.deepEqual(iceServers(), ICE_SERVERS, "defaults when none is set");

  const mine = { urls: "turn:relay.example.com:3478", username: "u", credential: "p" };
  saveTurn(mine);
  assert.deepEqual(loadTurn(), mine);
  const list = iceServers();
  const relays = list.filter((s) =>
    [].concat(s.urls).some((u) => u.startsWith("turn"))
  );
  assert.deepEqual(
    relays[0],
    { urls: [mine.urls], username: "u", credential: "p" },
    "the player's relay comes before the public ones"
  );
  assert.equal(list.length, ICE_SERVERS.length + 1);

  saveTurn(null);
  assert.equal(loadTurn(), null, "clearing works");
});

test("a relay can travel in the shared link", () => {
  assert.equal(turnFromUrl("?code=ABC"), null);
  assert.deepEqual(
    turnFromUrl("?turn=turn%3Arelay.example.com%3A3478&turnuser=bob&turnpass=s3cret"),
    { urls: "turn:relay.example.com:3478", username: "bob", credential: "s3cret" }
  );
  // A relay without credentials is still usable (some are open).
  assert.deepEqual(turnFromUrl("?turn=turn:open.example:3478"), {
    urls: "turn:open.example:3478",
    username: "",
    credential: "",
  });
});

test("corrupt stored relay data does not break startup", () => {
  localStorage.setItem("pingpong3d.turn", "{not json");
  assert.equal(loadTurn(), null);
  localStorage.setItem("pingpong3d.turn", JSON.stringify({ username: "u" }));
  assert.equal(loadTurn(), null, "an entry with no urls is ignored");
  localStorage.clear();
});

test("dead relay hosts are not shipped", () => {
  // A hostname that no longer resolves is not free: the browser waits on
  // it during every gathering pass. peerjs' TURN hosts stopped existing.
  const urls = ICE_SERVERS.flatMap((s) => [].concat(s.urls));
  for (const gone of ["eu-0.turn.peerjs.com", "us-0.turn.peerjs.com"]) {
    assert.ok(!urls.some((u) => u.includes(gone)), `${gone} must not be listed`);
  }
});

test("a TLS relay on 443 is offered, for networks that only allow HTTPS", () => {
  const urls = ICE_SERVERS.flatMap((s) => [].concat(s.urls));
  assert.ok(
    urls.some((u) => u.startsWith("turns:") && u.includes(":443")),
    "needs turns: on 443"
  );
});

test("credentials from a provider are understood in every shape they come in", () => {
  // metered: a bare array
  assert.deepEqual(
    parseIceResponse([
      { urls: "stun:stun.relay.metered.ca:80" },
      { urls: "turn:global.relay.metered.ca:80", username: "u", credential: "p" },
    ]),
    [
      { urls: ["stun:stun.relay.metered.ca:80"] },
      { urls: ["turn:global.relay.metered.ca:80"], username: "u", credential: "p" },
    ]
  );
  // cloudflare: one object under iceServers
  assert.deepEqual(
    parseIceResponse({
      iceServers: { urls: ["turn:turn.cloudflare.com:3478"], username: "u", credential: "p" },
    }),
    [{ urls: ["turn:turn.cloudflare.com:3478"], username: "u", credential: "p" }]
  );
  // the plain RTCConfiguration shape
  assert.deepEqual(parseIceResponse({ iceServers: [{ urls: "turn:a.example:3478" }] }), [
    { urls: ["turn:a.example:3478"] },
  ]);
  assert.deepEqual(parseIceResponse(null), []);
  assert.deepEqual(parseIceResponse({ error: "nope" }), []);
});

test("a provider that is down never blocks a connection", async () => {
  clearIceCache();
  assert.deepEqual(await fetchIceServers("https://relay.example/creds", {
    fetcher: async () => { throw new Error("offline"); },
  }), [], "a thrown fetch degrades to nothing");

  clearIceCache();
  assert.deepEqual(await fetchIceServers("https://relay.example/creds", {
    fetcher: async () => ({ ok: false, status: 500 }),
  }), [], "a 500 degrades to nothing");

  clearIceCache();
  assert.deepEqual(await fetchIceServers("", {}), [], "no endpoint, no request");
});

test("fetched credentials are cached briefly, then refetched", async () => {
  clearIceCache();
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return { ok: true, json: async () => [{ urls: "turn:a.example:3478", username: "u", credential: "p" }] };
  };
  let clock = 1000;
  const now = () => clock;
  await fetchIceServers("https://relay.example/creds", { fetcher, now });
  await fetchIceServers("https://relay.example/creds", { fetcher, now });
  assert.equal(calls, 1, "the second call is served from cache");
  clock += 6 * 60 * 1000;
  await fetchIceServers("https://relay.example/creds", { fetcher, now });
  assert.equal(calls, 2, "credentials expire, so they are fetched again");
  clearIceCache();
});

test("a fetched relay outranks the public ones but not the player's own", async () => {
  localStorage.clear();
  clearIceCache();
  const fetched = { urls: "turn:fetched.example:3478", username: "f", credential: "f" };
  const fetcher = async () => ({ ok: true, json: async () => [fetched] });
  const withFetched = await resolveIce({ endpoint: "https://relay.example/creds", fetcher });
  const relayUrls = withFetched
    .filter((s) => s.urls.some((u) => u.startsWith("turn")))
    .map((s) => s.urls[0]);
  assert.equal(relayUrls[0], "turn:fetched.example:3478");

  clearIceCache();
  const mine = { urls: "turn:mine.example:3478", username: "m", credential: "m" };
  const both = await resolveIce({ turn: mine, endpoint: "https://relay.example/creds", fetcher });
  const bothUrls = both
    .filter((s) => s.urls.some((u) => u.startsWith("turn")))
    .map((s) => s.urls[0]);
  assert.deepEqual(bothUrls.slice(0, 2), ["turn:mine.example:3478", "turn:fetched.example:3478"]);
  clearIceCache();
  localStorage.clear();
});

test("a credentials URL can travel in the shared link and be stored", () => {
  localStorage.clear();
  assert.equal(endpointFromUrl("?code=ABC"), "");
  assert.equal(
    endpointFromUrl("?ice=https%3A%2F%2Frelay.example%2Fcreds"),
    "https://relay.example/creds"
  );
  saveEndpoint("https://relay.example/creds");
  assert.equal(loadEndpoint(), "https://relay.example/creds");
  saveEndpoint("");
  assert.equal(loadEndpoint(), "");
  localStorage.clear();
});

test("the relay test reports a relayed address, or why there wasn't one", async () => {
  const relay = { urls: ["turn:a.example:3478"], username: "u", credential: "p" };

  // A relay that answers.
  const Working = class {
    constructor() { this.listeners = {}; }
    addEventListener(type, cb) { (this.listeners[type] ||= []).push(cb); }
    createDataChannel() {}
    async createOffer() { return {}; }
    async setLocalDescription() {
      for (const cb of this.listeners.icecandidate || []) {
        cb({ candidate: { candidate: "candidate:1 1 udp 1 3.4.5.6 5000 typ relay", url: "turn:a.example:3478" } });
      }
    }
    close() {}
  };
  const good = await probeRelay([relay], { RTC: Working, timeout: 500 });
  assert.equal(good.ok, true);
  assert.equal(good.server, "turn:a.example:3478");

  // A relay that rejects the credentials.
  const Rejecting = class extends Working {
    async setLocalDescription() {
      for (const cb of this.listeners.icecandidateerror || []) {
        cb({ errorCode: 401, errorText: "Unauthorized", url: "turn:a.example:3478" });
      }
    }
  };
  const bad = await probeRelay([relay], { RTC: Rejecting, timeout: 200 });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /rejected these credentials/);

  // Nothing configured at all.
  const none = await probeRelay([{ urls: ["stun:only.example:3478"] }], { RTC: Working });
  assert.equal(none.ok, false);
  assert.match(none.reason, /No relay is configured/);

  assert.match(candidateErrorText(701, ""), /could not be reached/);
});

test("a snapshot that arrives late never rewinds the game", () => {
  // PeerJS builds the data channel as { ordered: !!options.reliable }, so
  // for a long time this game ran on an unordered channel and a stale
  // snapshot could roll the score backwards on the guest's screen. The
  // channel is ordered now; this proves the protocol survives even if it
  // weren't.
  const { c, a, host, guest, match, flushAll } = setup();
  /** Put a raw message on the wire, exactly as the host would. */
  const wire = (msg) => { a.send(msg); flushAll(); };
  const input = idle();
  host.applyRemoteInput(input);
  for (let i = 0; i < 40; i++) {
    c.advance(STEP);
    const n = match.step(STEP, input);
    host.afterStep(match.drainEvents(), n);
  }
  flushAll();

  const fresh = {
    t: "snap",
    n: 500,
    ts: 9,
    ball: [1, 2, 3, 0, 0, 0, 0, 0],
    p: [0, 0, 0, 0],
    ph: "rally",
    srv: 1,
    sc: [5, 2],
    rally: 9,
  };
  wire(fresh);
  assert.deepEqual([...guest.state.scores], [5, 2]);

  // The same snapshot again, and an older one: both must be ignored.
  wire({ ...fresh, sc: [0, 0], rally: 0 });
  assert.deepEqual([...guest.state.scores], [5, 2], "a duplicate changes nothing");
  wire({ ...fresh, n: 499, sc: [1, 1], rally: 1 });
  assert.deepEqual([...guest.state.scores], [5, 2], "an older snapshot is dropped");

  // A newer one is applied as normal.
  wire({ ...fresh, n: 501, sc: [5, 3] });
  assert.deepEqual([...guest.state.scores], [5, 3]);
});

test("a snapshot from before a rematch cannot un-reset the score", () => {
  const { a, guest, flushAll } = setup();
  const wire = (msg) => { a.send(msg); flushAll(); };
  const snap = (n, sc) => ({
    t: "snap", n, ts: 1, ball: [0, 1, 0, 0, 0, 0, 0, 0],
    p: [0, 0, 0, 0], ph: "rally", srv: 1, sc, rally: 0,
  });
  wire(snap(10, [7, 4]));
  assert.deepEqual([...guest.state.scores], [7, 4]);
  wire({ t: "restart", n: 12 });
  assert.deepEqual([...guest.state.scores], [0, 0], "the rematch clears the score");
  wire(snap(11, [7, 4]));
  assert.deepEqual([...guest.state.scores], [0, 0], "a straggler from the old game is ignored");
  wire(snap(13, [0, 1]));
  assert.deepEqual([...guest.state.scores], [0, 1], "the new game still updates");
});
