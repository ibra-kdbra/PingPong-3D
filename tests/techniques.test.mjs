import { test } from "node:test";
import assert from "node:assert/strict";
import { createMatch, TECH, TABLE } from "../src/game/match.js";

function seededRng(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const DT = 1 / 120;
const base = () => ({
  p1x: 0, p1vx: 0, p1aim: 0, p1spin: 0, p1tech: TECH.DRIVE,
  p2x: 0, p2vx: 0, p2aim: 0, p2spin: 0, p2tech: TECH.DRIVE,
});

/** Feed p1 an incoming ball and return what happened to the return shot. */
function play(input, seed = 3) {
  const match = createMatch({ rng: seededRng(seed) });
  const { state } = match;
  state.phase = "rally";
  state.lastHitter = 2;
  state.bounces = 0;
  Object.assign(state.ball, { x: 0, y: 1.5, z: 7.3, vx: 0, vy: 0, vz: 8, sx: 0, ts: 0 });
  const events = new Array(16);
  const out = { hit: null, landing: null, apex: 0, hitToLand: 0 };
  let ticks = 0;
  for (let i = 0; i < 600; i++) {
    match.step(DT, input);
    if (out.hit) {
      ticks++;
      out.apex = Math.max(out.apex, state.ball.y);
    }
    const n = match.drainEvents(events);
    for (let j = 0; j < n; j++) {
      const e = events[j];
      if (e.type === "hit" && !out.hit) {
        out.hit = { speed: Math.hypot(state.ball.vx, state.ball.vy, state.ball.vz), sx: state.ball.sx, ts: state.ball.ts, tech: e.c };
      }
      if (e.type === "bounce" && out.hit && !out.landing) {
        out.landing = { x: state.ball.x, z: state.ball.z, side: e.a, vzAfter: state.ball.vz, vyAfter: state.ball.vy };
        out.hitToLand = ticks * DT;
        return out;
      }
      if (e.type === "point") return out;
    }
  }
  return out;
}

test("a chop is slow, high and loaded with backspin; it dies on the bounce", () => {
  const drive = play({ ...base(), p1aim: -0.2 });
  const chop = play({ ...base(), p1aim: -0.2, p1tech: TECH.CHOP });
  assert.equal(chop.hit.tech, TECH.CHOP);
  assert.equal(chop.hit.ts, -1);
  assert.ok(chop.hit.speed < drive.hit.speed, "chop travels slower");
  assert.ok(chop.hitToLand > drive.hitToLand * 1.25, "chop hangs longer");
  assert.equal(chop.landing.side, 2, "and still lands on the opponent's half");
  assert.ok(Math.abs(chop.landing.vzAfter) < Math.abs(drive.landing.vzAfter), "backspin kills forward pace off the bounce");
});

test("a loop carries heavy topspin, arcs higher, and kicks through the bounce", () => {
  const drive = play({ ...base(), p1aim: -0.2 });
  const loop = play({ ...base(), p1aim: -0.2, p1tech: TECH.LOOP });
  assert.equal(loop.hit.ts, 1);
  assert.equal(loop.landing.side, 2, "the dip is pre-compensated: it still lands in");
  assert.ok(loop.apex > drive.apex, "loop arcs higher than a flat drive");
  assert.ok(
    Math.abs(loop.landing.vzAfter) / Math.abs(loop.hit.speed) > Math.abs(drive.landing.vzAfter) / Math.abs(drive.hit.speed),
    "and keeps proportionally more pace after the kick"
  );
});

test("a brush shot curves visibly: it lands displaced in the spin direction", () => {
  const flat = play({ ...base(), p1vx: 20 });
  const brushR = play({ ...base(), p1vx: 20, p1spin: 1 });
  const brushL = play({ ...base(), p1vx: 20, p1spin: -1 });
  assert.ok(Math.abs(brushR.hit.sx) > 0.8, "brush loads real sidespin");
  assert.ok(brushR.landing.x > flat.landing.x + 0.6, "right brush bends right past the aim");
  assert.ok(brushL.landing.x < flat.landing.x - 0.3, "left brush bends left");
  assert.ok(Math.abs(brushR.landing.x) < TABLE.WIDTH / 2, "and still finds the table");
});

test("incidental swing spin stays fully compensated (no surprise drift)", () => {
  const still = play({ ...base() });
  const swing = play({ ...base(), p1vx: 25 });
  // Steering shifts the aim; the residual spin must not add a large extra
  // offset beyond the intended placement shift (1.6 * steer = 2.0).
  assert.ok(Math.abs(swing.landing.x - still.landing.x - 2.0) < 0.6);
});
