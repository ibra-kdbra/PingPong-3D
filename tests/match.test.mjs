import { test } from "node:test";
import assert from "node:assert/strict";
import { createMatch, makeAI, TABLE } from "../src/game/match.js";

/** Deterministic LCG so every run of the suite sees identical rallies. */
function seededRng(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const DT = 1 / 120;

function idleInput() {
  return { p1x: 0, p1vx: 0, p1aim: 0, p2x: 0, p2vx: 0, p2aim: 0 };
}

function run(match, input, seconds, onEvent) {
  const events = new Array(16);
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    match.step(DT, input);
    const n = match.drainEvents(events);
    for (let j = 0; j < n; j++) {
      if (onEvent && onEvent(events[j]) === false) return;
    }
  }
}

test("serve launches after the delay and bounces on the receiver side", () => {
  const match = createMatch({ rng: seededRng() });
  let served = false;
  let firstBounceSide = 0;
  run(match, idleInput(), 3, (e) => {
    if (e.type === "serve") served = true;
    if (e.type === "bounce" && firstBounceSide === 0) {
      firstBounceSide = e.a;
      return false;
    }
  });
  assert.equal(served, true);
  assert.equal(firstBounceSide, 2, "p1's serve must land on p2's half");
});

test("an unreturned serve gives the server the point (double bounce)", () => {
  const match = createMatch({ rng: seededRng(7) });
  // Human p2 parked far off the table: cannot return.
  const input = { ...idleInput(), p2x: 50 };
  let point = null;
  run(match, input, 6, (e) => {
    if (e.type === "point") {
      point = e;
      return false;
    }
  });
  assert.ok(point, "a point should be decided");
  assert.equal(point.a, 1, "server wins when the serve is not returned");
});

test("ball into the net loses the point for the hitter", () => {
  const match = createMatch({ rng: seededRng() });
  const { state } = match;
  // White-box: put a p1-struck ball just before the net, too low to clear.
  state.phase = "rally";
  state.lastHitter = 1;
  state.bounces = 0;
  Object.assign(state.ball, { x: 0, y: 0.6, z: 0.2, vx: 0, vy: 0, vz: -8 });
  let point = null;
  let netEvent = false;
  run(match, idleInput(), 1, (e) => {
    if (e.type === "net") netEvent = true;
    if (e.type === "point") {
      point = e;
      return false;
    }
  });
  assert.equal(netEvent, true);
  assert.equal(point.a, 2, "p2 gets the point when p1 nets");
  assert.equal(point.b, "net");
});

test("a shot that misses the table entirely is out — receiver's point", () => {
  const match = createMatch({ rng: seededRng() });
  const { state } = match;
  state.phase = "rally";
  state.lastHitter = 1;
  state.bounces = 0;
  // Sailing far over everything, heading long past p2's baseline.
  Object.assign(state.ball, { x: 20, y: 3, z: -2, vx: 0, vy: 2, vz: -14 });
  let point = null;
  run(match, idleInput(), 3, (e) => {
    if (e.type === "point") {
      point = e;
      return false;
    }
  });
  assert.ok(point);
  assert.equal(point.a, 2, "receiver wins when the shot lands out");
});

test("a competent AI returns the serve", () => {
  const match = createMatch({
    rng: seededRng(3),
    ai: makeAI({ speed: 16, error: 0, reactDelay: 0.05, aggression: 0.5 }),
  });
  let aiHit = false;
  run(match, idleInput(), 5, (e) => {
    if (e.type === "hit" && e.a === 2) {
      aiHit = true;
      return false;
    }
  });
  assert.equal(aiHit, true, "AI should reach and return the serve");
});

test("service alternates every two points and the match ends at winScore", () => {
  const match = createMatch({ rng: seededRng(9), winScore: 3 });
  const { state } = match;
  const servers = [state.server];
  // p2 parked away: p1 wins every rally.
  const input = { ...idleInput(), p2x: 50 };
  let over = null;
  run(match, input, 60, (e) => {
    if (e.type === "point") servers.push(state.server);
    if (e.type === "over") {
      over = e;
      return false;
    }
  });
  assert.ok(over, "match should finish");
  assert.equal(over.a, 1);
  assert.equal(state.winner, 1);
  assert.equal(state.scores[0], 3);
  // Server pattern with 2-point groups: 1,1,2 (match ends at 3-0).
  assert.deepEqual(servers.slice(0, 3), [1, 1, 2]);
});

test("the engine never allocates events beyond the drain buffer", () => {
  const match = createMatch({ rng: seededRng() });
  const input = idleInput();
  for (let i = 0; i < 1200; i++) {
    match.step(DT, input);
    assert.ok(match.state.events.length <= 8, "events must be drained/bounded");
    match.drainEvents(new Array(8));
  }
});

test("rally state stays finite and inside sane bounds for a long AI match", () => {
  const match = createMatch({
    rng: seededRng(11),
    winScore: 5,
    ai: makeAI({ speed: 14, error: 0.4, reactDelay: 0.1, aggression: 0.4 }),
  });
  const input = idleInput();
  const events = new Array(16);
  // Crude p1 bot: track the ball's x so rallies actually happen.
  for (let i = 0; i < 120 * 240 && match.state.phase !== "over"; i++) {
    input.p1x = Math.max(-6, Math.min(6, match.state.ball.x));
    match.step(DT, input);
    match.drainEvents(events);
    const b = match.state.ball;
    assert.ok(Number.isFinite(b.x + b.y + b.z + b.vx + b.vy + b.vz));
    assert.ok(Math.abs(b.x) < 60 && Math.abs(b.z) < 60 && b.y < 80);
  }
  assert.equal(match.state.phase, "over", "match should conclude");
});
