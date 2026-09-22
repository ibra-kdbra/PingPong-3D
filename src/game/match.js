/**
 * Table-tennis match engine.
 *
 * Pure JavaScript, no dependencies, no per-frame allocations: the caller
 * owns rendering and reads the mutable state each frame. Designed so the
 * whole rally loop can be unit-tested in Node.
 *
 * Coordinate system: table surface at y = 0, net at z = 0. Player 1 is on
 * the +z side, player 2 (AI or second human) on -z. Units are world units
 * (the table is 14 long by 8 wide, roughly 5x real proportions).
 *
 * Rules (arcade-simplified from real table tennis):
 * - A shot must clear the net and bounce on the opponent's half. Netting
 *   it or landing out loses the point for the hitter. A ball that clips
 *   the top of the net dribbles over as a "net cord" and stays in play.
 * - The receiver must return the ball before it bounces twice on their
 *   half or flies past their paddle; failing loses them the point.
 * - Serves alternate every 2 points and are tossed automatically.
 *
 * Physics: ballistic flight under (configurable) gravity, optional side
 * wind, Magnus curve from sidespin, and spin-dependent bounces — topspin
 * kicks low and fast off the table, backspin sits up and dies.
 */

export const TABLE = {
  LENGTH: 14,
  WIDTH: 8,
  NET_HEIGHT: 1.0,
  /** z of each paddle's hitting plane. */
  PADDLE_Z: 7.6,
};

/**
 * How far from the net each player may stand, as a distance (the engine
 * applies the sign for each side). HOME is where everyone starts and is
 * exactly the old fixed paddle plane, so a player who never moves in
 * depth plays the game it always was.
 *
 * Standing IN takes the ball early, over the end of the table: the return
 * reaches the opponent sooner, and a short ball is easy to get to — but a
 * deep, fast ball jams you. Standing BACK buys time to read a hard drive
 * or a curving ball and to reach one that would sail past — but your own
 * return is slower to arrive, and a short ball dies before you get there.
 */
export const DEPTH = { MIN: 6.6, HOME: TABLE.PADDLE_Z, MAX: 10.6 };

export const BALL_RADIUS = 0.22;
export const GRAVITY = -30;
/** How far (x) from the paddle centre a ball can still be reached. */
const PADDLE_REACH_X = 1.9;
/** The AI's reach is tighter — closer to the blade's real size. */
const AI_REACH_X = 1.25;
/** Inside this time-to-plane the AI abandons its read and scrambles. */
const AI_LATE_WINDOW = 0.22;
/** Highest ball a paddle can reach. */
const PADDLE_REACH_Y = 4.5;
/** Window around the paddle plane in which a hit registers. */
const HIT_WINDOW_BEFORE = 0.5;
const HIT_WINDOW_AFTER = 0.9;
const SERVE_DELAY = 0.9;
const BETWEEN_POINTS = 1.2;
/** Speed limit far beyond anything the solver produces; a runaway guard. */
const MAX_BALL_SPEED = 60;
/** Lateral acceleration per unit sidespin per unit of forward speed. */
const MAGNUS = 0.5;
/** Net-cord band above the fault line where the ball trickles over. */
const NET_CORD_BAND = BALL_RADIUS * 1.4;
/** Extra downward pull per unit topspin per unit forward speed (loops dip). */
const DIP = 0.35;
/** Fraction of a deliberate brush shot's curve the striker compensates for:
 *  the rest is real displacement — the ball bends past where it was aimed. */
const BRUSH_COMPENSATION = 0.35;

/**
 * How strongly a striker's depth stretches or shrinks the flight of their
 * return. Flight time scales with (distance to target / distance from
 * home) to this power: below 1, so stepping back makes a return slower to
 * arrive without turning it into a moon-ball, and stepping in quickens it
 * without making it unplayable.
 */
const DEPTH_FLIGHT_EXP = 0.7;

/** AI depth moves at this fraction of its lateral speed: stepping is
 *  heavier than reaching. */
const FOOTWORK_SPEED = 0.55;
/** Resolution of the footwork prediction, in world units of depth. */
const FOOTWORK_CELL = 0.1;

/** Shot techniques (input.pNtech). */
export const TECH = { DRIVE: 0, CHOP: 1, LOOP: 2 };

/** Gaussian-ish noise without allocations (sum of 3 uniforms). */
function noise(rng, scale) {
  return (rng() + rng() + rng() - 1.5) * scale;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** A requested distance from the net, kept on the court. Junk (NaN from a
 *  bad packet) means home rather than a paddle at infinity. */
const depthOf = (v) => (Number.isFinite(v) ? clamp(v, DEPTH.MIN, DEPTH.MAX) : DEPTH.HOME);

export function createMatch({
  /** AI config for player 2, or null when a human controls p2. */
  ai = null,
  winScore = 7,
  /** Injectable RNG for deterministic tests. */
  rng = Math.random,
  /** Stage physics modifiers. */
  gravity = GRAVITY,
  netHeight = TABLE.NET_HEIGHT,
  /** Constant side wind (world units/s^2), positive blows toward +x. */
  wind = 0,
  /** Table bounce energy retention. */
  restitution = 0.82,
} = {}) {
  const state = {
    /** 'serve' | 'rally' | 'between' | 'over' */
    phase: "serve",
    server: 1,
    scores: [0, 0],
    winner: 0,
    ball: {
      x: 0,
      y: 2,
      z: TABLE.PADDLE_Z,
      vx: 0,
      vy: 0,
      vz: 0,
      /** Sidespin -1..1: curves the flight sideways (Magnus effect). */
      sx: 0,
      /** Topspin (+) / backspin (-) -1..1: shapes the table bounce. */
      ts: 0,
    },
    paddles: [
      { x: 0, z: TABLE.PADDLE_Z, vx: 0 },
      { x: 0, z: -TABLE.PADDLE_Z, vx: 0 },
    ],
    /** 1 or 2 — who last struck the ball (0 = nobody yet). */
    lastHitter: 0,
    /** Bounces on the receiver's side since the last hit. */
    bounces: 0,
    /** Strikes since the serve — long rallies raise error pressure. */
    rallyHits: 0,
    /** Longest rally of the match, in strikes. */
    bestRally: 0,
    /** How stretched the last contact was, 0 (clean) .. 1 (fingertips). */
    lastStretch: 0,
    timer: SERVE_DELAY,
    config: { gravity, netHeight, wind, restitution, winScore },
    events: [],
  };

  const shot = { vx: 0, vy: 0, vz: 0 };
  const aiState = { targetX: 0, targetDepth: DEPTH.HOME, reactTimer: 0, committed: false };

  function emit(type, a = 0, b = 0, c = 0) {
    state.events.push({ type, a, b, c });
  }

  function sideOf(z) {
    return z > 0 ? 1 : 2;
  }

  function other(player) {
    return player === 1 ? 2 : 1;
  }

  /**
   * Flight-time multiplier for a shot `player` plays toward target depth
   * `tz`. It compares the distance the ball must travel from where they
   * are standing with the distance from home, so it is exactly 1 at home
   * — standing still in depth changes nothing about the game.
   */
  function depthScale(player, tz) {
    const stand = Math.abs(state.paddles[player - 1].z);
    const far = Math.abs(tz);
    return ((stand + far) / (DEPTH.HOME + far)) ** DEPTH_FLIGHT_EXP;
  }

  /** Solve a ballistic shot from the ball landing at (tx, 0, tz) in time T. */
  function solveShot(tx, tz, T, g = gravity) {
    const b = state.ball;
    shot.vx = (tx - b.x) / T;
    shot.vz = (tz - b.z) / T;
    shot.vy = (BALL_RADIUS - b.y - 0.5 * g * T * T) / T;
  }

  function placeForServe() {
    const server = state.server;
    const paddle = state.paddles[server - 1];
    const b = state.ball;
    b.x = paddle.x;
    b.y = 2.2;
    b.z = paddle.z;
    b.vx = b.vy = b.vz = 0;
    b.sx = b.ts = 0;
    state.lastHitter = 0;
    state.bounces = 0;
    state.phase = "serve";
    state.timer = SERVE_DELAY;
  }

  function launchServe() {
    const server = state.server;
    const dir = server === 1 ? -1 : 1;
    const tz = dir * TABLE.LENGTH * 0.32;
    solveShot(noise(rng, TABLE.WIDTH * 0.3), tz, 0.95 * depthScale(server, tz));
    const b = state.ball;
    b.vx = shot.vx;
    b.vy = shot.vy;
    b.vz = shot.vz;
    b.sx = 0;
    b.ts = 0;
    state.lastHitter = server;
    state.bounces = 0;
    state.rallyHits = 0;
    state.phase = "rally";
    emit("serve", server);
  }

  function awardPoint(player, reason) {
    state.scores[player - 1] += 1;
    state.phase = "between";
    state.timer = BETWEEN_POINTS;
    emit("point", player, reason);
    if (state.scores[player - 1] >= winScore) {
      state.phase = "over";
      state.winner = player;
      emit("over", player);
      return;
    }
    // Alternate service every 2 points, like the real game.
    const total = state.scores[0] + state.scores[1];
    state.server = Math.floor(total / 2) % 2 === 0 ? 1 : 2;
  }

  /**
   * Strike the ball for `player`.
   *  aim:     -1 (flat, fast drive) .. 1 (high, slow lob)
   *  steer:   sideways swing influence on placement (and a little spin)
   *  power:   0..1 swing speed — shortens flight time (smash)
   *  error:   accuracy noise scale (0 = perfect)
   *  targetX: explicit x placement (AI shot selection); null derives it
   *           from contact point + steer
   *  spin:    -1..1 deliberate sidespin (a "brush" shot). Incidental spin
   *           from steer is fully pre-compensated so the ball lands where
   *           aimed; a brush shot is only partly compensated, so it bends
   *           visibly past the aim — that displacement is the technique.
   *  tech:    TECH.DRIVE | TECH.CHOP (floating backspin that dies on the
   *           bounce) | TECH.LOOP (heavy topspin: high arc, dips, kicks)
   */
  function strike(player, { aim, steer, power, error, targetX = null, spin = 0, tech = 0 }) {
    const b = state.ball;
    const dir = player === 1 ? -1 : 1;
    const lob = (aim + 1) / 2; // 0..1
    let T = (0.55 + lob * 0.45) * (1 - 0.3 * power);
    let depth = 0.4 + (1 - lob) * 0.5; // drives go deep, lobs drop short
    let ts = clamp(-aim * (0.55 + 0.45 * power), -1, 1);
    let sx = clamp(steer * 0.45, -1, 1);
    let compensation = 1;
    if (tech === TECH.CHOP) {
      // Slow, high, short and loaded with backspin.
      T *= 1.4;
      depth = 0.35 + (1 - lob) * 0.35;
      ts = -1;
    } else if (tech === TECH.LOOP) {
      // Heavy topspin: arcs higher, dips late, kicks through the bounce.
      T *= 0.92;
      depth = Math.min(depth + 0.1, 0.94);
      ts = 1;
    }
    if (spin !== 0) {
      sx = clamp(sx + spin * 0.9, -1, 1);
      compensation = BRUSH_COMPENSATION;
    }
    // Distance costs accuracy: a stroke from deep behind the table has
    // further to travel and less margin, one taken over the end line is
    // tighter. Square-rooted so it shades the choice rather than deciding
    // it — and exactly 1 at home, like everything depth touches.
    const reach = Math.sqrt(Math.abs(state.paddles[player - 1].z) / DEPTH.HOME);
    const pressure = error * (1 + state.rallyHits * 0.22) * reach;
    const tz = dir * TABLE.LENGTH * 0.5 * Math.min(depth, 0.94) + noise(rng, pressure * 2);
    let tx = (targetX !== null ? targetX : b.x * 0.3 + steer * 1.6) + noise(rng, pressure);
    const margin = TABLE.WIDTH / 2 - 0.35;
    // Even a mishit aims near the table; error can still push it out.
    tx = clamp(tx, -margin - 1.2, margin + 1.2);

    // Where you stood decides how long your return takes to arrive: the
    // same stroke from deep behind the table is slower to reach the
    // opponent than one taken early over the end line.
    T *= depthScale(player, tz);

    // First pass for the forward speed, then re-solve with the topspin dip
    // folded into gravity and the Magnus curve (partly) pre-compensated.
    solveShot(tx, tz, T);
    const dipG = gravity - DIP * Math.max(ts, 0) * Math.abs(shot.vz);
    const curve = 0.5 * MAGNUS * sx * Math.abs(shot.vz) * T * T;
    solveShot(tx - curve * compensation, tz, T, dipG);

    b.vx = shot.vx;
    b.vy = shot.vy;
    b.vz = shot.vz;
    b.sx = sx;
    b.ts = ts;
    state.lastHitter = player;
    state.bounces = 0;
    state.rallyHits += 1;
    if (state.rallyHits > state.bestRally) state.bestRally = state.rallyHits;
    emit("hit", player, Math.hypot(shot.vx, shot.vy, shot.vz) * (1 + power), tech);
  }

  // Footwork scratch space, allocated once: one cell per FOOTWORK_CELL of
  // distance from the net, spanning every depth a hit window can reach.
  const CELL_FROM = DEPTH.MIN - HIT_WINDOW_BEFORE;
  const CELLS = Math.ceil((DEPTH.MAX + HIT_WINDOW_AFTER - CELL_FROM) / FOOTWORK_CELL) + 1;
  const hittable = new Uint8Array(CELLS);

  /** Does a paddle standing at depth `d` have a legal, reachable ball
   *  anywhere inside its hit window, per the last prediction? */
  function playableAt(d) {
    const lo = Math.max(0, Math.floor((d - HIT_WINDOW_BEFORE - CELL_FROM) / FOOTWORK_CELL));
    const hi = Math.min(CELLS - 1, Math.floor((d + HIT_WINDOW_AFTER - CELL_FROM) / FOOTWORK_CELL));
    for (let c = lo; c <= hi; c++) if (hittable[c]) return true;
    return false;
  }

  /**
   * Where should the AI stand for the incoming ball? Flies a copy of it
   * forward through the same physics as the real flight — gravity,
   * topspin dip, curve, wind, the bounce — and marks every stretch of the
   * AI's side where it can be played legally and within reach: after its
   * one bounce, before a second, at a height a paddle can meet. Then picks
   * the depth nearest home whose hit window catches such a stretch.
   *
   * Home wins whenever home works. Stepping away costs return speed and
   * accuracy, so footwork only ever moves an opponent that would
   * otherwise lose the ball — which is what makes it a skill rather than
   * a handicap.
   */
  function bestDepth(maxIn, maxBack) {
    // This flight and bounce mirror the rally physics in step(). Change one
    // and change the other, or opponents will step for a ball that is not
    // the one actually coming. (The footwork tests fly the real engine, so
    // they are the tripwire.)
    hittable.fill(0);
    const b = state.ball;
    let x = b.x, y = b.y, z = b.z, vx = b.vx, vy = b.vy, vz = b.vz, sx = b.sx, ts = b.ts;
    let bounces = state.bounces;
    const dt = 1 / 120;
    for (let i = 0; i < 480; i++) {
      vy += (gravity - DIP * Math.max(ts, 0) * Math.abs(vz)) * dt;
      vx += (MAGNUS * sx * Math.abs(vz) + wind) * dt;
      x += vx * dt;
      y += vy * dt;
      z += vz * dt;
      if (
        vy < 0 &&
        y <= BALL_RADIUS &&
        Math.abs(x) <= TABLE.WIDTH / 2 + BALL_RADIUS &&
        Math.abs(z) <= TABLE.LENGTH / 2 + BALL_RADIUS
      ) {
        y = BALL_RADIUS;
        vy = -vy * restitution * (1 - 0.18 * ts);
        vz *= 0.985 * (1 + 0.14 * ts);
        vx *= 0.97;
        ts *= 0.45;
        sx *= 0.6;
        if (z < 0) bounces++;
      }
      if (bounces >= 2 || y < -1) break;
      const cell = Math.floor((-z - CELL_FROM) / FOOTWORK_CELL);
      if (cell >= CELLS) break;
      if (cell >= 0 && bounces === 1 && y >= 0 && y <= PADDLE_REACH_Y - 0.2) hittable[cell] = 1;
    }
    if (playableAt(DEPTH.HOME)) return DEPTH.HOME;
    const furthest = Math.max(maxIn, maxBack);
    for (let k = 1; k * FOOTWORK_CELL <= furthest + 1e-9; k++) {
      const d = k * FOOTWORK_CELL;
      if (d <= maxBack + 1e-9 && playableAt(DEPTH.HOME + d)) return DEPTH.HOME + d;
      if (d <= maxIn + 1e-9 && playableAt(DEPTH.HOME - d)) return DEPTH.HOME - d;
    }
    return DEPTH.HOME;
  }

  /**
   * Opponent movement. Like a real player, the AI reads the shot once
   * (after its reaction delay) and commits to that position; only in the
   * last fraction of a second does it scramble toward where the ball
   * actually is. A spin-blind read extrapolates the initial direction, so
   * a curving ball beats a slow reader; spinRead adds the anticipated
   * curve (and wind) to the read.
   */
  function updateAI(dt) {
    const paddle = state.paddles[1];
    const b = state.ball;
    let target = 0;
    const incoming = state.phase === "rally" && b.vz < 0;
    if (incoming) {
      aiState.reactTimer += dt;
      const t = (paddle.z - b.z) / b.vz;
      if (!aiState.committed && aiState.reactTimer >= ai.reactDelay && t > 0) {
        const ax = MAGNUS * b.sx * Math.abs(b.vz) + wind;
        aiState.targetX = b.x + b.vx * t + ai.spinRead * 0.5 * ax * t * t;
        // The same read decides where to stand. More footwork, the further
        // it is willing to go to rescue a ball.
        if (ai.footwork > 0) {
          aiState.targetDepth = bestDepth(
            ai.footwork * (DEPTH.HOME - DEPTH.MIN),
            ai.footwork * (DEPTH.MAX - DEPTH.HOME)
          );
        }
        aiState.committed = true;
      }
      if (aiState.committed && t > 0 && t < AI_LATE_WINDOW) {
        aiState.targetX = b.x + b.vx * t;
      }
      target = aiState.targetX;
    } else {
      aiState.reactTimer = 0;
      aiState.committed = false;
      aiState.targetX = 0;
    }
    const dx = target - paddle.x;
    const maxStep = ai.speed * dt;
    paddle.vx = clamp(dx / Math.max(dt, 1e-4), -ai.speed, ai.speed);
    if (Math.abs(dx) <= maxStep) paddle.x = target;
    else paddle.x += Math.sign(dx) * maxStep;
    const limit = TABLE.WIDTH / 2 + 1.5;
    paddle.x = clamp(paddle.x, -limit, limit);

    // Footwork. Skipped outright for a flat-footed opponent, so the ones
    // without it play exactly as they always have.
    if (ai.footwork > 0) {
      const want = incoming && aiState.committed ? aiState.targetDepth : DEPTH.HOME;
      const dz = -want - paddle.z; // player 2 stands on the -z side
      const reach = ai.speed * FOOTWORK_SPEED * dt;
      paddle.z += Math.abs(dz) <= reach ? dz : Math.sign(dz) * reach;
    }
  }

  /**
   * Advance the simulation.
   * input: { p1x, p1vx, p1aim, p1spin, p1tech, p1z, p2x, p2vx, p2aim,
   * p2spin, p2tech, p2z } — p2 fields ignored when an AI is configured.
   * spin is a deliberate -1..1 sidespin (brush); tech is a TECH value.
   * pNz is how far from the net that player stands (a positive distance,
   * clamped to DEPTH; omit it to stay at home). Events accumulate in
   * state.events; the caller consumes and clears them via drainEvents().
   */
  function step(dt, input) {
    if (state.phase === "over") return;
    const b = state.ball;

    // Player paddles follow their inputs directly (kinematic). Depth is
    // optional: a caller that never sends it keeps the fixed home plane.
    const p1 = state.paddles[0];
    p1.x = input.p1x;
    p1.vx = input.p1vx;
    if (input.p1z !== undefined) p1.z = depthOf(input.p1z);
    if (ai) updateAI(dt);
    else {
      const p2 = state.paddles[1];
      p2.x = input.p2x;
      p2.vx = input.p2vx;
      if (input.p2z !== undefined) p2.z = -depthOf(input.p2z);
    }

    if (state.phase === "serve" || state.phase === "between") {
      state.timer -= dt;
      // Keep the waiting ball riding on the server's paddle.
      if (state.phase === "serve") {
        const server = state.paddles[state.server - 1];
        b.x = server.x;
        b.z = server.z;
      }
      if (state.timer <= 0) {
        if (state.phase === "between") placeForServe();
        else launchServe();
      }
      return;
    }

    // --- rally physics ---
    const prevZ = b.z;
    b.vy += (gravity - DIP * Math.max(b.ts, 0) * Math.abs(b.vz)) * dt;
    b.vx += (MAGNUS * b.sx * Math.abs(b.vz) + wind) * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;

    const speed = Math.hypot(b.vx, b.vy, b.vz);
    if (speed > MAX_BALL_SPEED) {
      const k = MAX_BALL_SPEED / speed;
      b.vx *= k;
      b.vy *= k;
      b.vz *= k;
    }

    // Net: the ball crossed z = 0 this step — was it high enough?
    if (Math.sign(prevZ) !== Math.sign(b.z) && prevZ !== 0) {
      const tCross = Math.abs(prevZ) / Math.max(Math.abs(b.z - prevZ), 1e-6);
      const yCross = b.y - b.vy * dt * (1 - tCross);
      const faultLine = netHeight + BALL_RADIUS * 0.5;
      if (yCross < faultLine) {
        emit("net", state.lastHitter);
        awardPoint(other(state.lastHitter), "net");
        return;
      }
      if (yCross < faultLine + NET_CORD_BAND) {
        // Clipped the cord: the ball loses most of its pace and pops
        // up, dribbling over — or dropping back, which is the hitter's
        // own-side bounce and their lost point.
        b.vz *= 0.35;
        b.vx *= 0.5;
        b.vy = Math.max(b.vy, 0) * 0.3 + 3;
        b.sx *= 0.3;
        b.ts = 0;
        emit("netcord", state.lastHitter);
      }
    }

    // Table bounce.
    if (
      b.vy < 0 &&
      b.y <= BALL_RADIUS &&
      Math.abs(b.x) <= TABLE.WIDTH / 2 + BALL_RADIUS &&
      Math.abs(b.z) <= TABLE.LENGTH / 2 + BALL_RADIUS
    ) {
      b.y = BALL_RADIUS;
      // Topspin kicks through low and fast; backspin sits up and dies.
      b.vy = -b.vy * restitution * (1 - 0.18 * b.ts);
      b.vz *= 0.985 * (1 + 0.14 * b.ts);
      b.vx *= 0.97;
      b.ts *= 0.45;
      b.sx *= 0.6;
      const side = sideOf(b.z);
      emit("bounce", side, Math.abs(b.vy));
      if (side === state.lastHitter) {
        // Own-side bounce after a hit: the shot never made it over.
        awardPoint(other(state.lastHitter), "out");
        return;
      }
      state.bounces += 1;
      if (state.bounces >= 2) {
        // Receiver let it bounce twice: hitter wins the point.
        awardPoint(state.lastHitter, "double-bounce");
      }
      return;
    }

    // Ball fell below the table: out, or past a napping receiver.
    if (b.y < -5) {
      if (state.bounces === 0) awardPoint(other(state.lastHitter), "out");
      else awardPoint(state.lastHitter, "missed");
      return;
    }

    // Paddle hits.
    for (let i = 0; i < 2; i++) {
      const player = i + 1;
      const paddle = state.paddles[i];
      const toward = player === 1 ? b.vz > 0 : b.vz < 0;
      if (!toward || state.lastHitter === player) continue;
      const dz = player === 1 ? b.z - paddle.z : paddle.z - b.z;
      if (dz < -HIT_WINDOW_BEFORE || dz > HIT_WINDOW_AFTER) continue;
      // No volleying over the table: a ball still above your own half has
      // to bounce there before you may play it. Only reachable by standing
      // in — from home the window starts beyond the end line — and the
      // ball simply carries on to the bounce, so standing in means taking
      // it early off the table rather than never.
      if (state.bounces === 0 && Math.abs(b.z) < TABLE.LENGTH / 2) continue;
      const reach = player === 2 && ai ? AI_REACH_X : PADDLE_REACH_X;
      const offset = Math.abs(b.x - paddle.x);
      if (offset > reach) continue;
      if (b.y > PADDLE_REACH_Y || b.y < -1) continue;
      // Contact quality: a ball met at the edge of the reach is a stretched,
      // off-centre hit — less power, more error. This is what makes a
      // curving or well-placed ball pay off against a scrambling opponent.
      const stretch = offset / reach;
      state.lastStretch = stretch;
      if (player === 2 && ai) {
        // AI shot selection: place across the width, wider when
        // aggressive; sidespin from its own guile; a stretched contact
        // becomes a defensive chop, a confident one may be a loop.
        const spread = (TABLE.WIDTH / 2 - 0.5) * (0.45 + ai.aggression * 0.5);
        const guile = (rng() * 2 - 1) * ai.spin;
        const tech =
          stretch > 0.6
            ? TECH.CHOP
            : rng() < ai.aggression * 0.5
              ? TECH.LOOP
              : TECH.DRIVE;
        strike(2, {
          aim: ai.aim(state, rng),
          steer: 0,
          spin: Math.abs(guile) > 0.45 ? guile : 0,
          tech,
          power: ai.aggression * rng() * (1 - 0.6 * stretch),
          error: ai.error * (1 + 2 * stretch * stretch) + 0.4 * stretch * stretch,
          targetX: (rng() * 2 - 1) * spread,
        });
      } else {
        const one = player === 1;
        const aim = one ? input.p1aim : input.p2aim;
        const vx = one ? input.p1vx : input.p2vx;
        const spin = clamp((one ? input.p1spin : input.p2spin) || 0, -1, 1);
        const tech = (one ? input.p1tech : input.p2tech) || 0;
        strike(player, {
          aim,
          steer: vx * 0.05,
          spin,
          tech,
          power: clamp(Math.abs(vx) / 30, 0, 1) * (1 - 0.5 * stretch),
          // A small base error lets rally pressure build even for humans,
          // so two parked paddles can't trade returns forever.
          error: 0.1 + 0.5 * stretch * stretch,
        });
      }
      return;
    }

    // Ball escaped past a paddle plane entirely. If it never bounced it
    // was sailing long — hitter's fault; otherwise the receiver missed.
    // Measured from where the receiver is actually standing: a player who
    // stepped back must not lose a ball that has not reached them yet.
    const behind = Math.abs(state.paddles[b.z > 0 ? 0 : 1].z);
    if (Math.abs(b.z) > behind + 2.5) {
      if (state.bounces === 0) awardPoint(other(state.lastHitter), "out");
      else awardPoint(state.lastHitter, "missed");
    }
  }

  function drainEvents(out) {
    if (state.events.length === 0) return 0;
    const n = state.events.length;
    for (let i = 0; i < n; i++) out[i] = state.events[i];
    state.events.length = 0;
    return n;
  }

  placeForServe();
  return { state, step, drainEvents };
}

/**
 * Build an AI config from a difficulty spec.
 *  speed      paddle speed (world units/s)
 *  error      shot noise scale — lower is deadlier
 *  reactDelay seconds before it starts tracking an incoming ball
 *  aggression 0..1 share of flat, powerful drives
 *  spin       0..1 how much sidespin it puts on its own shots
 *  spinRead   0..1 how well it anticipates the curve of incoming spin
 *  footwork   0..1 how much it steps in and back with the ball's pace
 *             (0 = flat-footed at the fixed plane, as before depth existed)
 */
export function makeAI({
  speed,
  error,
  reactDelay,
  aggression,
  spin = 0,
  spinRead = 0,
  footwork = 0,
}) {
  return {
    speed,
    error,
    reactDelay,
    aggression,
    spin,
    spinRead,
    footwork,
    /** Pick shot loft: aggressive opponents drive flat and deep. */
    aim(state, rng) {
      return rng() < aggression ? -0.7 + rng() * 0.4 : -0.1 + rng() * 0.7;
    },
  };
}
