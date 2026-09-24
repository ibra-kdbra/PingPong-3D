import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BTN, STICK_DEAD, STEP_DEAD, MOVE_SPEED, SWING,
  deadzone, readPad, mergePads, assignPads, createPadPlayer, drivePadPlayer, padLabels,
} from "../src/game/gamepad.js";

/** A fake standard-layout controller: axes [lx, ly, rx, ry], y down like the API. */
function gp({ index = 0, id = "Xbox Wireless Controller", axes = [0, 0, 0, 0], press = [], values = {} } = {}) {
  const buttons = Array.from({ length: 17 }, (_, i) => ({
    pressed: press.includes(i),
    value: values[i] ?? (press.includes(i) ? 1 : 0),
  }));
  return { index, id, axes, buttons, connected: true, mapping: "standard" };
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const DT = 1 / 60;

test("deadzone: rest noise is ignored, and the live range starts from zero", () => {
  assert.deepEqual(deadzone(0.1, -0.1), [0, 0]);
  assert.deepEqual(deadzone(STICK_DEAD, 0), [0, 0]);
  const [x] = deadzone(STICK_DEAD + 0.01, 0);
  assert.ok(x > 0 && x < 0.02, `just past the deadzone is slow, got ${x}`);
  const [fx, fy] = deadzone(1, 0);
  assert.ok(near(fx, 1) && fy === 0, "full tilt is full");
  // Radial: a diagonal keeps its direction.
  const [dx, dy] = deadzone(0.6, 0.6);
  assert.ok(near(dx, dy), "a diagonal stays diagonal");
});

test("readPad: sticks read up as positive, like the mouse; buttons and triggers map to strokes", () => {
  const s = readPad(gp({ axes: [0, -1, 0, 1], press: [BTN.LB], values: { [BTN.RT]: 0.9, [BTN.LT]: 0.2 } }));
  assert.ok(near(s.ly, 1), "stick pushed up reads +1");
  assert.ok(near(s.ry, -1), "right stick pulled down reads -1");
  assert.equal(s.curve, true, "a shoulder button is curve");
  assert.equal(s.loop, true, "a squeezed right trigger is loop");
  assert.equal(s.chop, false, "a trigger barely touched is not held");
  assert.equal(readPad(gp({ press: [BTN.RB] })).curve, true, "either shoulder curves");
  assert.equal(readPad(gp({ values: { [BTN.LT]: 0.5 } })).chop, true, "left trigger chops");
});

test("mergePads: any controller plays player 1, and the busiest one gets the rumble", () => {
  const a = readPad(gp({ index: 0, axes: [0.3, 0, 0, 0] }));
  const b = readPad(gp({ index: 2, axes: [-1, 0, 0, 0], press: [BTN.RT] }));
  const m = mergePads([a, b]);
  assert.ok(m.lx < -0.9, "the stronger push wins");
  assert.equal(m.loop, true, "a button on either counts");
  assert.equal(m.index, 2, "rumble goes to the controller doing the work");
  assert.equal(mergePads([]), null);
});

test("assignPads: two players split controllers in connection order; one player gets them all", () => {
  const a = readPad(gp({ index: 0 }));
  const b = readPad(gp({ index: 1 }));
  const [v1, v2] = assignPads([a, b], true);
  assert.equal(v1.index, 0);
  assert.equal(v2.index, 1);
  const [one, none] = assignPads([a], true);
  assert.equal(one.index, 0, "one controller in two-player is player 1's");
  assert.equal(none, null, "player 2 stays on the keyboard");
  const [solo, nobody] = assignPads([a, b], false);
  assert.ok(solo && nobody === null, "solo: merged into player 1");
});

test("the left stick walks the paddle and it stays where you leave it", () => {
  const p = createPadPlayer();
  const full = readPad(gp({ axes: [1, 0, 0, 0] }));
  for (let i = 0; i < 12; i++) drivePadPlayer(p, full, DT, { from: { x: 0, y: 0 } });
  assert.equal(p.active, true, "moving the stick takes the paddle");
  assert.ok(near(p.x, MOVE_SPEED * 12 * DT, 1e-6), `full tilt moves at MOVE_SPEED, got ${p.x}`);
  const parked = p.x;
  for (let i = 0; i < 30; i++) drivePadPlayer(p, readPad(gp()), DT, { from: { x: 0, y: 0 } });
  assert.equal(p.x, parked, "letting go leaves the paddle where it is");
  for (let i = 0; i < 200; i++) drivePadPlayer(p, full, DT);
  assert.equal(p.x, 1, "and it stops at the edge of reach");
});

test("half tilt is much slower than full: fine placement", () => {
  const p = createPadPlayer();
  drivePadPlayer(p, readPad(gp({ axes: [0.59, 0, 0, 0] })), 1, { from: { x: -1, y: 0 } });
  const half = p.x + 1;
  assert.ok(half > 0.3 && half < 0.5 * MOVE_SPEED, `half tilt covers ${half.toFixed(2)} of ${MOVE_SPEED}`);
});

test("taking over from the mouse starts where the mouse left the paddle", () => {
  const p = createPadPlayer();
  drivePadPlayer(p, readPad(gp({ axes: [0.19, 0, 0, 0] })), DT, { from: { x: 0.5, y: 0.2 } });
  assert.ok(Math.abs(p.x - 0.5) < 0.01, `no jump: ${p.x}`);
});

test("buttons alone don't take the paddle from the mouse", () => {
  const p = createPadPlayer();
  drivePadPlayer(p, readPad(gp({ press: [BTN.RT, BTN.LB] })), DT, { from: { x: 0.4, y: 0 } });
  assert.equal(p.active, false);
  assert.equal(p.loop, true, "but the stroke still counts");
  assert.equal(p.curve, true);
});

test("the right stick is the swing: a flick across moves the paddle fast, then it returns", () => {
  const p = createPadPlayer();
  drivePadPlayer(p, readPad(gp({ axes: [0, 0, -1, 0] })), DT, { from: { x: 0, y: 0 } });
  assert.ok(near(p.x, -SWING), "pulled back");
  const before = p.x;
  drivePadPlayer(p, readPad(gp({ axes: [0, 0, 1, 0] })), DT);
  assert.ok(near(p.x, SWING), "flicked through");
  // In the match 1 pointer unit is 6.5 world units: a flick in one frame
  // is far past the 30 units/s the engine calls a smash.
  const worldSpeed = ((p.x - before) * 6.5) / DT;
  assert.ok(worldSpeed > 30, `flick speed ${worldSpeed.toFixed(0)} u/s`);
  drivePadPlayer(p, readPad(gp()), DT);
  assert.ok(near(p.x, 0), "let go and the arm comes back to where your feet are");
});

test("at the table the right stick's height is loft, and it settles to a drive", () => {
  const p = createPadPlayer();
  drivePadPlayer(p, readPad(gp({ axes: [0, 0, 0, -1] })), DT, { from: { x: 0, y: 0.7 } });
  assert.ok(near(p.y, 1), "right stick up: a lob");
  drivePadPlayer(p, readPad(gp({ axes: [0.5, 0, 0, 0] })), DT);
  assert.equal(p.y, 0, "released: neutral");
});

test("stepping needs a clear push; a sideways push that drifts doesn't step", () => {
  const p = createPadPlayer();
  drivePadPlayer(p, readPad(gp({ axes: [1, -0.35, 0, 0] })), DT, { from: { x: 0, y: 0 } });
  assert.equal(p.step, 0, "sideways with a little up is still just sideways");
  drivePadPlayer(p, readPad(gp({ axes: [0, -1, 0, 0] })), DT);
  assert.ok(near(p.step, -1), "stick up: step in toward the net");
  drivePadPlayer(p, readPad(gp({ axes: [0, 1, 0, 0] })), DT);
  assert.ok(near(p.step, 1), "stick down: step back");
  const barely = (STEP_DEAD + 1) / 2;
  drivePadPlayer(p, readPad(gp({ axes: [0, deadzoneInverse(barely), 0, 0] })), DT);
  assert.ok(p.step > 0.3 && p.step < 0.7, `part way: a slower walk (${p.step.toFixed(2)})`);
  drivePadPlayer(p, readPad(gp({ press: [BTN.UP] })), DT);
  assert.equal(p.step, -1, "D-pad up steps in");
  drivePadPlayer(p, readPad(gp({ press: [BTN.DOWN] })), DT);
  assert.equal(p.step, 1, "D-pad down steps back");
});

/** The raw axis value that reads as `v` once the deadzone is taken off. */
function deadzoneInverse(v) {
  return v * (1 - STICK_DEAD) + STICK_DEAD;
}

test("stepping in the keep-up mode is off: the left stick moves the paddle up and down instead", () => {
  const p = createPadPlayer();
  for (let i = 0; i < 10; i++) {
    drivePadPlayer(p, readPad(gp({ axes: [0, -1, 0, 0] })), DT, { keepup: true, from: { x: 0, y: 0 } });
  }
  assert.equal(p.step, 0);
  assert.ok(near(p.y, MOVE_SPEED * 10 * DT, 1e-6), `stick up raises the paddle, got ${p.y}`);
  drivePadPlayer(p, readPad(gp({ axes: [0, 0, 0, -1] })), DT, { keepup: true });
  assert.ok(near(p.y, MOVE_SPEED * 10 * DT + SWING, 1e-6), "the right stick swings it up from there");
});

test("D-pad left and right move at full speed", () => {
  const p = createPadPlayer();
  drivePadPlayer(p, readPad(gp({ press: [BTN.LEFT] })), 0.1, { from: { x: 0, y: 0 } });
  assert.ok(near(p.x, -MOVE_SPEED * 0.1, 1e-9));
});

test("unplugging lets go of everything", () => {
  const p = createPadPlayer();
  drivePadPlayer(p, readPad(gp({ axes: [1, 1, 0, 0], press: [BTN.RT] })), DT, { from: { x: 0, y: 0 } });
  drivePadPlayer(p, null, DT);
  assert.deepEqual(p, createPadPlayer());
});

test("button names follow the controller", () => {
  assert.equal(padLabels("Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)").loop, "RT");
  assert.equal(padLabels("DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)").loop, "R2");
  assert.equal(padLabels("Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)").loop, "ZR");
  assert.equal(padLabels("").curve, "LB/RB");
});
