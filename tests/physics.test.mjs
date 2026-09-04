import { test } from "node:test";
import assert from "node:assert/strict";
import { createMatch, makeAI, TABLE, GRAVITY } from "../src/game/match.js";

function seededRng(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const DT = 1 / 120;
const idle = () => ({ p1x: 0, p1vx: 0, p1aim: 0, p2x: 0, p2vx: 0, p2aim: 0 });

function run(match, input, seconds, onEvent) {
  const events = new Array(16);
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    match.step(DT, input);
    const n = match.drainEvents(events);
    for (let j = 0; j < n; j++) if (onEvent?.(events[j]) === false) return;
  }
}

/** Put a rally ball in flight for p1 toward p2 with the given state. */
function inFlight(match, fields) {
  const { state } = match;
  state.phase = "rally";
  state.lastHitter = 1;
  state.bounces = 0;
  Object.assign(state.ball, { sx: 0, ts: 0, ...fields });
}

test("sidespin curves the flight (Magnus effect)", () => {
  const straight = createMatch({ rng: seededRng() });
  const curved = createMatch({ rng: seededRng() });
  const start = { x: 0, y: 2, z: 6, vx: 0, vy: 6, vz: -16 };
  inFlight(straight, start);
  inFlight(curved, { ...start, sx: 1 });
  const stop = (e) => e.type !== "bounce";
  run(straight, idle(), 0.5, stop);
  run(curved, idle(), 0.5, stop);
  assert.ok(Math.abs(straight.state.ball.x) < 0.01, "no spin flies straight");
  assert.ok(curved.state.ball.x > 0.8, "sidespin bends the ball sideways");
});

test("a struck ball still lands where aimed despite its curve", () => {
  // The solver pre-compensates spin, so a hard sideways swing (lots of
  // sidespin) must not throw the shot wide of the table.
  const match = createMatch({ rng: seededRng(5) });
  const { state } = match;
  state.phase = "rally";
  state.lastHitter = 2;
  state.bounces = 0;
  Object.assign(state.ball, { x: 0, y: 1.5, z: 7.3, vx: 0, vy: 0, vz: 8 });
  const input = { ...idle(), p1vx: 35 }; // violent sideways swing
  let landing = null;
  let spinAtHit = 0;
  run(match, input, 2, (e) => {
    if (e.type === "hit") spinAtHit = state.ball.sx;
    if (e.type === "bounce") {
      landing = { x: state.ball.x, side: e.a };
      return false;
    }
  });
  assert.ok(landing, "the shot should land");
  assert.equal(landing.side, 2);
  assert.ok(Math.abs(landing.x) < TABLE.WIDTH / 2, "lands on the table");
  assert.ok(Math.abs(spinAtHit) > 0.5, "and it carried real sidespin");
});

test("a ball clipping the net cord stays in play", () => {
  const match = createMatch({ rng: seededRng() });
  const { state } = match;
  // Aim to cross z=0 just above the fault line: fault line is
  // netHeight + R/2 = 1.11; the cord band extends ~0.31 above it.
  inFlight(match, { x: 0, y: 1.25, z: 0.3, vx: 0, vy: 0, vz: -10 });
  const seen = [];
  run(match, idle(), 0.3, (e) => {
    seen.push(e.type);
  });
  assert.ok(seen.includes("netcord"), "net cord event fires");
  assert.ok(!seen.includes("net"), "not called as a net fault");
  assert.ok(!seen.includes("point"), "no point decided yet");
  assert.ok(state.ball.vz < 0 && state.ball.vz > -5, "pace is killed");
});

test("below the cord band it is still a net fault", () => {
  const match = createMatch({ rng: seededRng() });
  inFlight(match, { x: 0, y: 0.8, z: 0.3, vx: 0, vy: 0, vz: -10 });
  let point = null;
  run(match, idle(), 0.5, (e) => {
    if (e.type === "point") {
      point = e;
      return false;
    }
  });
  assert.equal(point?.b, "net");
  assert.equal(point?.a, 2);
});

test("topspin kicks lower and faster off the table than backspin", () => {
  const top = createMatch({ rng: seededRng() });
  const back = createMatch({ rng: seededRng() });
  const drop = { x: 0, y: 1, z: -3, vx: 0, vy: -8, vz: -10 };
  inFlight(top, { ...drop, ts: 1 });
  inFlight(back, { ...drop, ts: -1 });
  const stop = (e) => e.type !== "bounce";
  run(top, idle(), 0.3, stop);
  run(back, idle(), 0.3, stop);
  assert.ok(
    Math.abs(top.state.ball.vz) > Math.abs(back.state.ball.vz),
    "topspin keeps more forward pace"
  );
  assert.ok(top.state.ball.vy < back.state.ball.vy, "topspin stays lower");
});

test("low gravity keeps the ball airborne longer", () => {
  const earth = createMatch({ rng: seededRng() });
  const moon = createMatch({ rng: seededRng(), gravity: -16 });
  const toss = { x: 0, y: 2, z: 6, vx: 0, vy: 8, vz: -12 };
  inFlight(earth, toss);
  inFlight(moon, toss);
  let tEarth = 0;
  let tMoon = 0;
  const timer = (ref) => (e) => {
    if (e.type === "bounce") return false;
    return true;
  };
  const events = new Array(16);
  for (let i = 0; i < 600; i++) {
    earth.step(DT, idle());
    tEarth = i * DT;
    if ([...Array(earth.drainEvents(events)).keys()].some((k) => events[k].type === "bounce")) break;
  }
  for (let i = 0; i < 600; i++) {
    moon.step(DT, idle());
    tMoon = i * DT;
    if ([...Array(moon.drainEvents(events)).keys()].some((k) => events[k].type === "bounce")) break;
  }
  void timer;
  assert.ok(tMoon > tEarth * 1.4, `moon ${tMoon}s vs earth ${tEarth}s`);
  assert.equal(GRAVITY, -30);
});

test("a raised net turns a clearing drive into a fault", () => {
  const normal = createMatch({ rng: seededRng() });
  const high = createMatch({ rng: seededRng(), netHeight: 1.45 });
  const drive = { x: 0, y: 1.3, z: 0.3, vx: 0, vy: 0, vz: -12 };
  inFlight(normal, drive);
  inFlight(high, drive);
  const outcome = (m) => {
    let r = "clear";
    run(m, idle(), 0.2, (e) => {
      if (e.type === "net") r = "net";
      if (e.type === "netcord") r = "cord";
    });
    return r;
  };
  assert.notEqual(outcome(normal), "net");
  assert.equal(outcome(high), "net");
});

test("a curving ball stretches a spin-blind AI; a spin-reader meets it cleanly", () => {
  const play = (spinRead) => {
    const match = createMatch({
      rng: seededRng(8),
      ai: makeAI({ speed: 5, error: 0, reactDelay: 0.1, aggression: 0, spinRead }),
    });
    // Strong sidespin: a blind read commits the AI to x≈1.5 while the
    // curve carries the ball on toward x≈3.8.
    inFlight(match, { x: 1, y: 2, z: 5, vx: 0, vy: 5, vz: -14, sx: 1 });
    let stretch = null;
    run(match, idle(), 2, (e) => {
      if (e.type === "hit" && e.a === 2) {
        stretch = match.state.lastStretch;
        return false;
      }
      if (e.type === "point") return false;
    });
    return stretch;
  };
  const blind = play(0);
  const reader = play(1);
  assert.ok(reader !== null && reader < 0.3, `reader meets it cleanly (${reader})`);
  assert.ok(
    blind === null || blind > 0.7,
    `blind opponent misses or is at full stretch (${blind})`
  );
});

test("a stretched contact is a weaker, wilder shot", () => {
  const speeds = [];
  const spreads = [];
  for (const offset of [0, 1.8]) {
    const match = createMatch({ rng: seededRng(4) });
    const { state } = match;
    state.phase = "rally";
    state.lastHitter = 2;
    state.bounces = 0;
    Object.assign(state.ball, { x: offset, y: 1.5, z: 7.3, vx: 0, vy: 0, vz: 8 });
    run(match, { ...idle(), p1x: 0, p1vx: 30 }, 0.2, (e) => {
      if (e.type === "hit") {
        speeds.push(Math.hypot(state.ball.vx, state.ball.vy, state.ball.vz));
        spreads.push(state.lastStretch);
        return false;
      }
    });
  }
  assert.equal(speeds.length, 2);
  assert.ok(spreads[0] < 0.1 && spreads[1] > 0.9, "stretch is measured");
  assert.ok(speeds[1] < speeds[0], "a fingertip hit carries less pace");
});

test("swing power shortens flight time (smash)", () => {
  const speeds = [];
  for (const p1vx of [0, 30]) {
    const match = createMatch({ rng: seededRng(3) });
    const { state } = match;
    state.phase = "rally";
    state.lastHitter = 2;
    state.bounces = 0;
    Object.assign(state.ball, { x: 0, y: 1.5, z: 7.3, vx: 0, vy: 0, vz: 8 });
    run(match, { ...idle(), p1vx }, 0.2, (e) => {
      if (e.type === "hit") {
        speeds.push(Math.hypot(state.ball.vx, state.ball.vy, state.ball.vz));
        return false;
      }
    });
  }
  assert.equal(speeds.length, 2);
  assert.ok(speeds[1] > speeds[0] * 1.15, "a fast swing produces a faster ball");
});
