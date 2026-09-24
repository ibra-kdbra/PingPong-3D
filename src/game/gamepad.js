/**
 * Game controllers, through the browser's Gamepad API.
 *
 * The sticks split the way a player's body does: the left stick is the
 * feet (move sideways, step in and back), the right stick is the arm
 * (flick it across to swing, up to lob, down to drive). Strokes sit under
 * the index fingers so both thumbs can stay on the sticks.
 *
 * Everything here that decides what a controller means is plain data in,
 * plain data out, so it is tested in Node like the match engine. The only
 * browser calls are getPads() and rumble().
 */

/** Button indices in the W3C "standard" layout (Xbox names). */
export const BTN = {
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9, L3: 10, R3: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
};

/** Stick travel ignored around centre: worn sticks rest a little off it. */
export const STICK_DEAD = 0.18;
/** How far a trigger has to be squeezed to count as held. */
export const TRIGGER_ON = 0.35;
/**
 * The left stick moves you sideways and steps you in or back. Sideways is
 * what you do all the time, and nobody pushes a stick perfectly flat, so a
 * step needs a clear push up or down past this.
 */
export const STEP_DEAD = 0.5;
/** Full tilt crosses the whole reach (-1..1) in about 0.8 s. */
export const MOVE_SPEED = 2.6;
/** How far the right stick carries the paddle past where your feet are. */
export const SWING = 0.22;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Radial deadzone, rescaled so the live range still starts at zero: a
 * stick just past the deadzone moves slowly instead of jumping in at 18%.
 */
export function deadzone(x, y, dead = STICK_DEAD) {
  const m = Math.hypot(x, y);
  if (m <= dead) return [0, 0];
  const k = Math.min(1, (m - dead) / (1 - dead)) / m;
  return [x * k, y * k];
}

const held = (b) => !!b && (b.pressed || b.value > TRIGGER_ON);

/**
 * One controller, as the game reads it. Stick y is flipped so up is
 * positive, the same way round as the mouse pointer.
 */
export function readPad(gp) {
  const a = gp.axes || [];
  const b = gp.buttons || [];
  const [lx, ly] = deadzone(a[0] || 0, -(a[1] || 0));
  const [rx, ry] = deadzone(a[2] || 0, -(a[3] || 0));
  const on = (i) => held(b[i]);
  return {
    index: gp.index,
    id: gp.id || "",
    lx, ly, rx, ry,
    a: on(BTN.A), b: on(BTN.B),
    curve: on(BTN.LB) || on(BTN.RB),
    loop: on(BTN.RT),
    chop: on(BTN.LT),
    back: on(BTN.BACK), start: on(BTN.START),
    up: on(BTN.UP), down: on(BTN.DOWN), left: on(BTN.LEFT), right: on(BTN.RIGHT),
  };
}

/**
 * Several controllers read as one: the stronger push on each stick, any
 * button held on any of them. In the one-player modes every connected
 * controller plays for you, so it doesn't matter which one you picked up.
 * The index is the controller doing the most, for rumble.
 */
export function mergePads(snaps) {
  if (snaps.length === 0) return null;
  if (snaps.length === 1) return snaps[0];
  const out = { ...snaps[0] };
  let lead = Math.hypot(out.lx, out.ly) + Math.hypot(out.rx, out.ry);
  for (const s of snaps.slice(1)) {
    if (Math.hypot(s.lx, s.ly) > Math.hypot(out.lx, out.ly)) { out.lx = s.lx; out.ly = s.ly; }
    if (Math.hypot(s.rx, s.ry) > Math.hypot(out.rx, out.ry)) { out.rx = s.rx; out.ry = s.ry; }
    for (const k of ["a", "b", "curve", "loop", "chop", "back", "start", "up", "down", "left", "right"]) {
      out[k] = out[k] || s[k];
    }
    const effort = Math.hypot(s.lx, s.ly) + Math.hypot(s.rx, s.ry);
    if (effort > lead) { lead = effort; out.index = s.index; out.id = s.id; }
  }
  return out;
}

/**
 * Who plays with which controller. Two players: the first controller is
 * player 1 and the second player 2, in the order they were connected
 * (player 1 can still use the mouse, player 2 the keyboard). Otherwise
 * every controller is player 1.
 */
export function assignPads(snaps, versus) {
  if (!versus) return [mergePads(snaps), null];
  return [snaps[0] || null, snaps[1] || null];
}

/** One player's controller state, kept across frames. */
export function createPadPlayer() {
  return {
    /** The controller has the paddle (it moved last, not the mouse). */
    active: false,
    /** Where the paddle is, in the pointer's -1..1 units. */
    x: 0, y: 0,
    /** Where the left stick has walked it, before the right stick's swing. */
    baseX: 0, baseY: 0,
    /** Step in (-) or back (+), -1..1 — the stick's analog W/S. */
    step: 0,
    curve: false, loop: false, chop: false,
    /** Controller to rumble for this player, -1 for none. */
    index: -1,
  };
}

export function resetPadPlayer(p) {
  Object.assign(p, createPadPlayer());
}

/** Gentle near centre, full speed at full tilt: fine placement and fast cover. */
const response = (v) => Math.sign(v) * Math.abs(v) ** 1.5;

/**
 * Advance one player's controller for a frame.
 *
 *  snap     that player's readPad() result, or null if none is connected
 *  dt       seconds since the last frame
 *  keepup   keep-up mode: the left stick moves the paddle up and down as
 *           well, and there is no stepping (there is no table to step to)
 *  from     where the paddle is now in pointer units ({x, y}), so taking
 *           over from the mouse doesn't make the paddle jump
 *
 * Buttons count whether or not the controller has the paddle, so a mouse
 * player can still hold a trigger; only the sticks and D-pad take the
 * paddle over. The mouse takes it back by moving (the caller clears
 * active for that).
 */
export function drivePadPlayer(p, snap, dt, { keepup = false, from = { x: 0, y: 0 } } = {}) {
  if (!snap) {
    resetPadPlayer(p);
    return p;
  }
  p.index = snap.index;
  p.curve = snap.curve;
  p.loop = snap.loop;
  p.chop = snap.chop;

  const padX = (snap.right ? 1 : 0) - (snap.left ? 1 : 0);
  const padY = (snap.up ? 1 : 0) - (snap.down ? 1 : 0);
  const moveX = padX || response(snap.lx);
  const moveY = keepup ? padY || response(snap.ly) : 0;

  if (keepup) {
    p.step = 0;
  } else {
    // Stick up walks you in, toward the net: a smaller depth.
    const ly = Math.abs(snap.ly) > STEP_DEAD
      ? -Math.sign(snap.ly) * (Math.abs(snap.ly) - STEP_DEAD) / (1 - STEP_DEAD)
      : 0;
    p.step = clamp(ly + (snap.down ? 1 : 0) - (snap.up ? 1 : 0), -1, 1);
  }

  const moving = moveX !== 0 || moveY !== 0 || snap.rx !== 0 || snap.ry !== 0;
  if (moving && !p.active) {
    p.active = true;
    p.baseX = clamp(from.x, -1, 1);
    p.baseY = clamp(from.y, -1, 1);
  }
  if (!p.active) return p;

  p.baseX = clamp(p.baseX + moveX * MOVE_SPEED * dt, -1, 1);
  p.x = clamp(p.baseX + snap.rx * SWING, -1, 1);
  if (keepup) {
    p.baseY = clamp(p.baseY + moveY * MOVE_SPEED * dt, -1, 1);
    p.y = clamp(p.baseY + snap.ry * SWING, -1, 1);
  } else {
    // At the table height is loft, not position: the right stick sets it
    // and it settles back to a neutral drive when you let go.
    p.y = snap.ry;
  }
  return p;
}

/**
 * Button names to show a player, from the controller's own id. Sony and
 * Nintendo pads report their vendor id; everything else gets Xbox names,
 * which is what the standard layout is drawn from.
 */
export function padLabels(id = "") {
  const s = id.toLowerCase();
  if (/054c|dualsense|dualshock|playstation/.test(s)) {
    return { curve: "L1/R1", loop: "R2", chop: "L2", start: "Options", back: "Create" };
  }
  if (/057e|nintendo|pro controller|joy-con/.test(s)) {
    return { curve: "L/R", loop: "ZR", chop: "ZL", start: "+", back: "−" };
  }
  return { curve: "LB/RB", loop: "RT", chop: "LT", start: "Start", back: "Back" };
}

/** Connected controllers, in connection order. Never throws. */
export function getPads() {
  try {
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    return Array.from(list || []).filter((gp) => gp && gp.connected);
  } catch {
    return [];
  }
}

/** A short buzz on one controller, if it can. Never throws. */
export function rumble(index, strong, weak, ms) {
  if (index < 0) return;
  try {
    const gp = getPads().find((g) => g.index === index);
    const r = gp?.vibrationActuator?.playEffect?.("dual-rumble", {
      duration: ms,
      strongMagnitude: clamp(strong, 0, 1),
      weakMagnitude: clamp(weak, 0, 1),
    });
    r?.catch?.(() => {});
  } catch {
    // No rumble motor, or the browser won't allow it: play on without.
  }
}

/**
 * The live controller state for each player, written once per frame by
 * PadInput before anything reads it (MatchScene, the keep-up paddle, the
 * camera). Index 0 is player 1.
 */
export const padPlayers = [createPadPlayer(), createPadPlayer()];
