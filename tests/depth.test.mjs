import { test } from "node:test";
import assert from "node:assert/strict";
import { createMatch, makeAI, DEPTH, TABLE, TECH } from "../src/game/match.js";

const STEP = 1 / 120;
const ev = new Array(64);

function seeded(s) {
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const input = (extra = {}) => ({
  p1x: 0, p1vx: 0, p1aim: 0, p1spin: 0, p1tech: TECH.DRIVE,
  p2x: 0, p2vx: 0, p2aim: 0, p2spin: 0, p2tech: TECH.DRIVE,
  ...extra,
});

/** Step until `until(event)` says stop, or the time runs out. */
function run(m, inp, seconds, until, each) {
  for (let i = 0; i < seconds * 120; i++) {
    each?.(m.state, inp);
    m.step(STEP, inp);
    const n = m.drainEvents(ev);
    for (let k = 0; k < n; k++) if (until(ev[k], m.state)) return ev[k];
  }
  return null;
}

/**
 * Put a ball in the air as though player `from` had just struck it, then
 * let player `to` — standing at `depth` — try to return it. Returns what
 * happened: "hit" if `to` played it, otherwise the point reason.
 */
function receive({ ball, to = 1, depth, track = true }) {
  const m = createMatch({ rng: () => 0.5 });
  const s = m.state;
  s.phase = "rally";
  s.lastHitter = to === 1 ? 2 : 1;
  s.bounces = 0;
  Object.assign(s.ball, { sx: 0, ts: 0, ...ball });
  const inp = input(to === 1 ? { p1z: depth, p2z: DEPTH.HOME } : { p1z: DEPTH.HOME, p2z: depth });
  const e = run(
    m,
    inp,
    4,
    (e) => (e.type === "hit" && e.a === to) || e.type === "point",
    (st, i) => {
      if (!track) return;
      if (to === 1) i.p1x = Math.max(-6, Math.min(6, st.ball.x));
      else i.p2x = Math.max(-6, Math.min(6, st.ball.x));
    }
  );
  if (!e) return "unresolved";
  return e.type === "hit" ? "hit" : `point:${e.b}`;
}

// ---------------------------------------------------------------- basics

test("depth moves the paddle, is kept on the court, and junk means home", () => {
  const m = createMatch({ rng: () => 0.5 });
  const cases = [
    [DEPTH.MIN, DEPTH.MIN],
    [9.1, 9.1],
    [DEPTH.MAX, DEPTH.MAX],
    [99, DEPTH.MAX],
    [0, DEPTH.MIN],
    [-40, DEPTH.MIN],
    [NaN, DEPTH.HOME],
    [Infinity, DEPTH.HOME],
  ];
  for (const [asked, got] of cases) {
    m.step(STEP, input({ p1z: asked, p2z: asked }));
    assert.equal(m.state.paddles[0].z, got, `p1 asked ${asked}`);
    assert.equal(m.state.paddles[1].z, -got, `p2 asked ${asked}: player 2 stands on -z`);
  }
});

test("a caller that never sends depth keeps the fixed plane it always had", () => {
  const m = createMatch({ rng: () => 0.5 });
  for (let i = 0; i < 600; i++) m.step(STEP, input());
  assert.equal(m.state.paddles[0].z, TABLE.PADDLE_Z);
  assert.equal(m.state.paddles[1].z, -TABLE.PADDLE_Z);
  assert.equal(DEPTH.HOME, TABLE.PADDLE_Z, "home is exactly the old plane");
});

test("standing at home is the same game, event for event", () => {
  // The strongest guarantee depth can make: sending depth = HOME every
  // step reproduces a match with no depth at all, to the last bit.
  const play = (withDepth) => {
    const rng = seeded(11);
    const irng = seeded(99);
    const m = createMatch({
      rng,
      ai: makeAI({ speed: 12, error: 0.5, reactDelay: 0.14, aggression: 0.45, spin: 0.4, spinRead: 0.6 }),
    });
    const inp = input(withDepth ? { p1z: DEPTH.HOME } : {});
    const log = [];
    for (let i = 0; i < 120 * 200 && m.state.phase !== "over"; i++) {
      inp.p1x = Math.max(-6, Math.min(6, m.state.ball.x + (irng() - 0.5) * 3));
      inp.p1vx = (irng() - 0.5) * 40;
      inp.p1aim = irng() * 2 - 1;
      m.step(STEP, inp);
      const n = m.drainEvents(ev);
      for (let k = 0; k < n; k++) log.push(`${i}:${ev[k].type}:${ev[k].a}:${ev[k].b}`);
    }
    return { log, scores: [...m.state.scores] };
  };
  const without = play(false);
  const withHome = play(true);
  assert.ok(without.log.length > 200, "a real match was played");
  assert.deepEqual(withHome.log, without.log);
  assert.deepEqual(withHome.scores, without.scores);
});

// ------------------------------------------------------------ trade-offs

test("where you stand decides how soon your return reaches them", () => {
  const flight = (depth) => {
    const m = createMatch({ rng: () => 0.5 });
    const inp = input({ p1z: depth, p2z: DEPTH.HOME });
    let hitAt = -1;
    for (let i = 0; i < 120 * 12; i++) {
      inp.p1x = m.state.ball.x;
      inp.p2x = m.state.ball.x;
      m.step(STEP, inp);
      const n = m.drainEvents(ev);
      for (let k = 0; k < n; k++) {
        if (ev[k].type === "hit" && ev[k].a === 1 && hitAt < 0) hitAt = i;
        if (ev[k].type === "hit" && ev[k].a === 2 && hitAt >= 0) return (i - hitAt) / 120;
      }
    }
    return NaN;
  };
  const inT = flight(DEPTH.MIN);
  const homeT = flight(DEPTH.HOME);
  const backT = flight(DEPTH.MAX);
  assert.ok(inT < homeT && homeT < backT, `in ${inT}s < home ${homeT}s < back ${backT}s`);
  // Enough to matter, not enough to be absurd.
  assert.ok(backT / homeT > 1.08 && backT / homeT < 1.25, `back is ${(backT / homeT).toFixed(3)}x home`);
  assert.ok(homeT / inT > 1.02 && homeT / inT < 1.1, `home is ${(homeT / inT).toFixed(3)}x in`);
});

test("distance costs accuracy by exactly the square root of how far back you are", () => {
  // A stroke with no spin and no loft, so the flight solve is exact and
  // nothing but the accuracy cost can make depth matter. Stepped finely:
  // at 1/120 s a landing snaps to a 0.12-unit grid, which is large next to
  // the scatter being measured and would swamp the effect.
  const FINE = 1 / 1200;
  const scatter = (depth) => {
    const zs = [];
    for (let seed = 1; seed <= 300; seed++) {
      const m = createMatch({ rng: seeded(seed) });
      const s = m.state;
      s.phase = "rally";
      s.lastHitter = 2;
      s.bounces = 1;
      s.rallyHits = 4;
      Object.assign(s.ball, { x: 0.5, y: 1.2, z: depth - 0.6, vx: 0, vy: 1, vz: 14, sx: 0, ts: 0 });
      const inp = input({ p1x: 0.5, p1z: depth, p2z: DEPTH.MAX });
      let hit = false;
      for (let i = 0; i < 6000; i++) {
        m.step(FINE, inp);
        const n = m.drainEvents(ev);
        let done = false;
        for (let k = 0; k < n; k++) {
          if (ev[k].type === "hit" && ev[k].a === 1) hit = true;
          if (hit && ev[k].type === "bounce" && ev[k].a === 2) {
            zs.push(s.ball.z);
            done = true;
          }
          if (ev[k].type === "point") done = true;
        }
        if (done) break;
      }
    }
    assert.equal(zs.length, 300, "every return landed");
    const mean = zs.reduce((a, b) => a + b, 0) / zs.length;
    return Math.sqrt(zs.reduce((a, b) => a + (b - mean) ** 2, 0) / zs.length);
  };
  const tight = scatter(DEPTH.MIN);
  const home = scatter(DEPTH.HOME);
  const loose = scatter(DEPTH.MAX);
  const near = (got, want) => Math.abs(got / want - 1) < 0.02;
  const backVsHome = Math.sqrt(DEPTH.MAX / DEPTH.HOME);
  const homeVsIn = Math.sqrt(DEPTH.HOME / DEPTH.MIN);
  assert.ok(near(loose / home, backVsHome), `back/home ${(loose / home).toFixed(4)}, want ${backVsHome.toFixed(4)}`);
  assert.ok(near(home / tight, homeVsIn), `home/in ${(home / tight).toFixed(4)}, want ${homeVsIn.toFixed(4)}`);
});

test("stepping back plays a backspin lob that sits up out of reach at home", () => {
  // Heavy backspin: it lands on your half and sits up. At home it is still
  // above the paddle's reach as it passes and the point is lost; from the
  // back of the court it has come down. (Found by searching the engine,
  // not tuned into it: every neighbouring speed behaves the same way.)
  const lob = { x: 0, y: 1.5, z: -7, vx: 0, vy: 17, vz: 9, ts: -1 };
  assert.equal(receive({ ball: lob, depth: DEPTH.HOME }), "point:missed", "home loses it");
  assert.equal(receive({ ball: lob, depth: DEPTH.MAX }), "hit", "back plays it");
});

test("standing back also plays balls that were going long — and gives up that point", () => {
  // The honest cost. The paddle plays any ball that enters its reach; it
  // cannot choose to let one go. From home this high ball sails past and
  // lands out, winning the point for you. From the back it is in reach,
  // gets played, and the free point is gone. Pinned so that changing it
  // is a decision, not an accident.
  const long = { x: 0, y: 1.5, z: -7, vx: 0, vy: 22, vz: 13 };
  assert.equal(receive({ ball: long, depth: DEPTH.HOME }), "point:out", "home: it goes out, your point");
  assert.equal(receive({ ball: long, depth: DEPTH.MAX }), "hit", "back: you play an out ball");
});

test("stepping in takes the drop shot before its second bounce", () => {
  // A dead backspin ball that lands short and bounces again before the
  // end line: gone by the time it reaches home, but playable from over
  // the table. (One of 360 such balls the search found; every neighbour
  // behaves the same.)
  const drop = { x: 0, y: 1.2, z: 1, vx: 0, vy: 3.25, vz: 6.75, ts: -1 };
  assert.equal(receive({ ball: drop, depth: DEPTH.HOME }), "point:double-bounce", "home is too late");
  assert.equal(receive({ ball: drop, depth: DEPTH.MIN }), "hit", "in is in time");
});

// ------------------------------------------------------------------ rules

test("no volleying over the table: the ball must bounce on your half first", () => {
  const m = createMatch({ rng: () => 0.5 });
  const s = m.state;
  s.phase = "rally";
  s.lastHitter = 2;
  s.bounces = 0;
  // Descending to land on the table near z = 6.3 — inside the window of a
  // paddle standing all the way in, before the end line. Without the rule
  // it is volleyed at z = 6.1, before it ever touches the table.
  Object.assign(s.ball, { x: 0, y: 1.2, z: 4, vx: 0, vy: -3, vz: 14, sx: 0, ts: 0 });
  let bouncedFirst = false;
  const e = run(m, input({ p1z: DEPTH.MIN }), 2, (e) => {
    if (e.type === "bounce" && e.a === 1) bouncedFirst = true;
    return (e.type === "hit" && e.a === 1) || e.type === "point";
  });
  assert.equal(e?.type, "hit", "it is still played — just not early");
  assert.equal(bouncedFirst, true, "and only after it bounced on player 1's half");
});

test("a player who stepped back does not lose a ball that hasn't reached them", () => {
  // From home this ball would be called past at z > 10.1. A receiver at
  // the back of the court still gets to play it.
  const deep = { x: 0, y: 1.6, z: 4.5, vx: 0, vy: 5.5, vz: 17, ts: 0.6 };
  const r = receive({ ball: { ...deep }, depth: DEPTH.MAX });
  assert.equal(r, "hit");
});

// -------------------------------------------------------------------- AI

test("a flat-footed opponent never leaves home", () => {
  const m = createMatch({
    rng: seeded(5),
    ai: makeAI({ speed: 14, error: 0.4, reactDelay: 0.1, aggression: 0.6, spin: 0.6, spinRead: 0.75 }),
  });
  const irng = seeded(6);
  const inp = input();
  for (let i = 0; i < 120 * 60 && m.state.phase !== "over"; i++) {
    inp.p1x = Math.max(-6, Math.min(6, m.state.ball.x + (irng() - 0.5) * 2));
    inp.p1aim = irng() * 2 - 1;
    inp.p1tech = irng() < 0.2 ? TECH.CHOP : TECH.DRIVE;
    m.step(STEP, inp);
    m.drainEvents(ev);
    assert.equal(m.state.paddles[1].z, -DEPTH.HOME);
  }
});

test("footwork steps back for the lob a flat-footed opponent loses", () => {
  const attempt = (footwork) => {
    const m = createMatch({
      rng: () => 0.5,
      ai: makeAI({ speed: 14, error: 0.3, reactDelay: 0.05, aggression: 0.3, footwork }),
    });
    const s = m.state;
    s.phase = "rally";
    s.lastHitter = 1;
    s.bounces = 0;
    // The same sitting-up backspin lob, played toward the opponent.
    Object.assign(s.ball, { x: 0, y: 1.5, z: 7, vx: 0, vy: 17, vz: -9, sx: 0, ts: -1 });
    let deepest = 0;
    const e = run(m, input(), 4, (e) => (e.type === "hit" && e.a === 2) || e.type === "point", (st) => {
      deepest = Math.max(deepest, -st.paddles[1].z);
    });
    return { hit: e?.type === "hit", deepest };
  };
  const flat = attempt(0);
  const quick = attempt(1);
  assert.equal(flat.hit, false, "flat-footed at home, it goes over its head");
  assert.equal(flat.deepest, DEPTH.HOME);
  assert.equal(quick.hit, true, "with footwork it steps back and plays it");
  assert.ok(quick.deepest > DEPTH.HOME + 0.5, `stepped back to ${quick.deepest.toFixed(2)}`);
});

test("footwork stays home when home works, and drifts home between points", () => {
  const m = createMatch({
    rng: () => 0.5,
    ai: makeAI({ speed: 14, error: 0.3, reactDelay: 0.05, aggression: 0.3, footwork: 1 }),
  });
  const s = m.state;
  // A plain drive that a paddle at home meets comfortably.
  s.phase = "rally";
  s.lastHitter = 1;
  s.bounces = 0;
  Object.assign(s.ball, { x: 0, y: 1.4, z: 7, vx: 0, vy: 4, vz: -17, sx: 0, ts: 0 });
  let moved = 0;
  run(m, input(), 3, (e) => (e.type === "hit" && e.a === 2) || e.type === "point", (st) => {
    moved = Math.max(moved, Math.abs(-st.paddles[1].z - DEPTH.HOME));
  });
  assert.equal(moved, 0, "no reason to move, so it doesn't");
});

test("an opponent that stepped away comes back home once the ball has gone", () => {
  // It must actually have left home first — otherwise "returns home" would
  // pass for an opponent that simply never moves.
  const m = createMatch({
    rng: () => 0.5,
    ai: makeAI({ speed: 14, error: 0.3, reactDelay: 0.05, aggression: 0.3, footwork: 1 }),
  });
  const s = m.state;
  s.phase = "rally";
  s.lastHitter = 1;
  s.bounces = 0;
  Object.assign(s.ball, { x: 0, y: 1.5, z: 7, vx: 0, vy: 17, vz: -9, sx: 0, ts: -1 });
  const hit = run(m, input(), 4, (e) => (e.type === "hit" && e.a === 2) || e.type === "point");
  assert.equal(hit?.type, "hit");
  const away = -s.paddles[1].z;
  assert.ok(away > DEPTH.HOME + 0.5, `stepped back to ${away.toFixed(2)} to play it`);

  // Its return is now heading for player 1: nothing is coming its way.
  for (let i = 0; i < 120 * 1.5; i++) {
    m.step(STEP, input({ p1x: 50 })); // player 1 nowhere near, the point plays out
    m.drainEvents(ev);
  }
  assert.equal(s.paddles[1].z, -DEPTH.HOME, "and walks back home");
});

test("stronger campaign opponents have footwork; the first two stay flat-footed", async () => {
  const { STAGES } = await import("../src/game/stages.js");
  const fw = STAGES.map((st) => st.ai.footwork ?? 0);
  assert.equal(fw[0], 0);
  assert.equal(fw[1], 0);
  for (let i = 1; i < fw.length; i++) assert.ok(fw[i] >= fw[i - 1], `stage ${i + 1} not below stage ${i}`);
  assert.equal(fw.at(-1), 1, "the last opponent has full footwork");
});
