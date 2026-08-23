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
 * Arcade rules (simplified from real table tennis):
 * - A shot must fly directly over the net and bounce on the opponent's
 *   half. Hitting the net or landing out loses the point for the hitter.
 * - The receiver must return the ball before it bounces twice on their
 *   half or flies past their paddle; failing loses them the point.
 * - Serves alternate every 2 points and are tossed automatically.
 */

export const TABLE = {
  LENGTH: 14,
  WIDTH: 8,
  NET_HEIGHT: 1.0,
  /** z of each paddle's hitting plane. */
  PADDLE_Z: 7.6,
};

export const BALL_RADIUS = 0.22;
export const GRAVITY = -30;
const TABLE_RESTITUTION = 0.82;
/** How far (x) from the paddle centre a ball can still be reached. */
const PADDLE_REACH_X = 1.9;
/** Highest ball a paddle can reach. */
const PADDLE_REACH_Y = 4.5;
/** Window around the paddle plane in which a hit registers. */
const HIT_WINDOW_BEFORE = 0.5;
const HIT_WINDOW_AFTER = 0.9;
const SERVE_DELAY = 1.1;
/** Speed limit far beyond anything the solver produces; a runaway guard. */
const MAX_BALL_SPEED = 60;

/** Solve a ballistic shot from (x0,y0,z0) landing at (tx, 0, tz) in time T. */
function solveShot(out, x0, y0, z0, tx, tz, T) {
  out.vx = (tx - x0) / T;
  out.vz = (tz - z0) / T;
  out.vy = (BALL_RADIUS - y0 - 0.5 * GRAVITY * T * T) / T;
}

/** Height of the ball when it crosses z = 0, given current state. */
function heightAtNet(ball) {
  if (ball.vz === 0) return Infinity;
  const t = (0 - ball.z) / ball.vz;
  if (t < 0) return Infinity;
  return ball.y + ball.vy * t + 0.5 * GRAVITY * t * t;
}

/** Gaussian-ish noise without allocations (sum of 3 uniforms). */
function noise(rng, scale) {
  return (rng() + rng() + rng() - 1.5) * scale;
}

export function createMatch({
  /** AI config for player 2, or null when a human controls p2. */
  ai = null,
  winScore = 7,
  /** Injectable RNG for deterministic tests. */
  rng = Math.random,
} = {}) {
  const state = {
    /** 'serve' | 'rally' | 'between' | 'over' */
    phase: "serve",
    server: 1,
    scores: [0, 0],
    winner: 0,
    ball: { x: 0, y: 2, z: TABLE.PADDLE_Z, vx: 0, vy: 0, vz: 0 },
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
    timer: SERVE_DELAY,
    /** Set true for one step after each state change the caller may need. */
    events: [],
  };

  const shot = { vx: 0, vy: 0, vz: 0 };
  const aiState = { targetX: 0, reactTimer: 0 };

  function emit(type, a = 0, b = 0) {
    state.events.push({ type, a, b });
  }

  function sideOf(z) {
    return z > 0 ? 1 : 2;
  }

  function other(player) {
    return player === 1 ? 2 : 1;
  }

  function placeForServe() {
    const server = state.server;
    const paddle = state.paddles[server - 1];
    state.ball.x = paddle.x;
    state.ball.y = 2.2;
    state.ball.z = paddle.z;
    state.ball.vx = 0;
    state.ball.vy = 0;
    state.ball.vz = 0;
    state.lastHitter = 0;
    state.bounces = 0;
    state.phase = "serve";
    state.timer = SERVE_DELAY;
  }

  function launchServe() {
    const server = state.server;
    const dir = server === 1 ? -1 : 1;
    const spread = TABLE.WIDTH * 0.3;
    solveShot(
      shot,
      state.ball.x,
      state.ball.y,
      state.ball.z,
      noise(rng, spread),
      dir * TABLE.LENGTH * 0.32,
      0.95
    );
    state.ball.vx = shot.vx;
    state.ball.vy = shot.vy;
    state.ball.vz = shot.vz;
    state.lastHitter = server;
    state.bounces = 0;
    state.rallyHits = 0;
    state.phase = "rally";
    emit("serve", server);
  }

  function awardPoint(player, reason) {
    state.scores[player - 1] += 1;
    state.phase = "between";
    state.timer = 1.4;
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
   * Strike the ball for `player`. aim: -1 (flat, fast drive) .. 1 (high,
   * slow lob). steer: extra x placement influence (paddle swing).
   * error: accuracy noise scale (0 = perfect). targetX: explicit x
   * placement (AI shot selection); null derives it from contact + steer.
   * Error pressure grows with rally length so rallies always resolve.
   */
  function strike(player, aim, steer, error, targetX = null) {
    const ball = state.ball;
    const dir = player === 1 ? -1 : 1;
    const lob = (aim + 1) / 2; // 0..1
    const T = 0.55 + lob * 0.45;
    const depth = 0.4 + (1 - lob) * 0.5; // drives go deep, lobs drop short
    const tz = dir * TABLE.LENGTH * 0.5 * Math.min(depth, 0.94);
    const pressure = error * (1 + state.rallyHits * 0.22);
    let tx =
      (targetX !== null ? targetX : ball.x * 0.3 + steer * 1.6) +
      noise(rng, pressure);
    const margin = TABLE.WIDTH / 2 - 0.35;
    // Even a mishit aims near the table; error can still push it out.
    if (tx > margin + 1.2) tx = margin + 1.2;
    if (tx < -margin - 1.2) tx = -margin - 1.2;
    solveShot(
      shot,
      ball.x,
      ball.y,
      ball.z,
      tx,
      tz + noise(rng, pressure * 2),
      T
    );
    ball.vx = shot.vx;
    ball.vy = shot.vy;
    ball.vz = shot.vz;
    state.lastHitter = player;
    state.bounces = 0;
    state.rallyHits += 1;
    emit("hit", player, Math.hypot(shot.vx, shot.vy, shot.vz));
  }

  function updateAI(dt) {
    if (!ai) return;
    const paddle = state.paddles[1];
    const ball = state.ball;
    let target = 0;
    const incoming = state.phase === "rally" && ball.vz < 0;
    if (incoming) {
      aiState.reactTimer += dt;
      if (aiState.reactTimer >= ai.reactDelay) {
        // Linear x prediction at the paddle plane (no spin in this engine).
        const t = (paddle.z - ball.z) / ball.vz;
        if (t > 0) aiState.targetX = ball.x + ball.vx * t;
      }
      target = aiState.targetX;
    } else {
      aiState.reactTimer = 0;
      aiState.targetX = 0;
      target = 0;
    }
    const dx = target - paddle.x;
    const maxStep = ai.speed * dt;
    paddle.vx = Math.max(-ai.speed, Math.min(ai.speed, dx / Math.max(dt, 1e-4)));
    if (Math.abs(dx) <= maxStep) paddle.x = target;
    else paddle.x += Math.sign(dx) * maxStep;
    const limit = TABLE.WIDTH / 2 + 1.5;
    paddle.x = Math.max(-limit, Math.min(limit, paddle.x));
  }

  /**
   * Advance the simulation.
   * input: { p1x, p1vx, p1aim, p2x, p2vx, p2aim } — p2 fields ignored
   * when an AI is configured. Events accumulate in state.events; the
   * caller consumes and clears them via drainEvents().
   */
  function step(dt, input) {
    if (state.phase === "over") return;
    const ball = state.ball;

    // Player paddles follow their inputs directly (kinematic).
    const p1 = state.paddles[0];
    p1.x = input.p1x;
    p1.vx = input.p1vx;
    if (ai) updateAI(dt);
    else {
      const p2 = state.paddles[1];
      p2.x = input.p2x;
      p2.vx = input.p2vx;
    }

    if (state.phase === "serve" || state.phase === "between") {
      state.timer -= dt;
      // Keep the waiting ball riding on the server's paddle.
      if (state.phase === "serve") {
        const server = state.paddles[state.server - 1];
        ball.x = server.x;
        ball.z = server.z;
      }
      if (state.timer <= 0) {
        if (state.phase === "between") placeForServe();
        else launchServe();
      }
      return;
    }

    // --- rally physics ---
    const prevZ = ball.z;
    ball.vy += GRAVITY * dt;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.z += ball.vz * dt;

    const speed = Math.hypot(ball.vx, ball.vy, ball.vz);
    if (speed > MAX_BALL_SPEED) {
      const k = MAX_BALL_SPEED / speed;
      ball.vx *= k;
      ball.vy *= k;
      ball.vz *= k;
    }

    // Net: the ball crossed z = 0 this step — was it high enough?
    if (Math.sign(prevZ) !== Math.sign(ball.z) && prevZ !== 0) {
      const tCross = Math.abs(prevZ) / Math.max(Math.abs(ball.z - prevZ), 1e-6);
      const yCross = ball.y - ball.vy * dt * (1 - tCross);
      if (yCross < TABLE.NET_HEIGHT + BALL_RADIUS * 0.5) {
        emit("net", state.lastHitter);
        awardPoint(other(state.lastHitter), "net");
        return;
      }
    }

    // Table bounce.
    if (
      ball.vy < 0 &&
      ball.y <= BALL_RADIUS &&
      Math.abs(ball.x) <= TABLE.WIDTH / 2 + BALL_RADIUS &&
      Math.abs(ball.z) <= TABLE.LENGTH / 2 + BALL_RADIUS
    ) {
      ball.y = BALL_RADIUS;
      ball.vy = -ball.vy * TABLE_RESTITUTION;
      ball.vx *= 0.97;
      ball.vz *= 0.985;
      const side = sideOf(ball.z);
      emit("bounce", side);
      if (side === state.lastHitter) {
        // Own-side bounce after a hit: the shot never made it over.
        awardPoint(other(state.lastHitter), "out");
        return;
      }
      state.bounces += 1;
      if (state.bounces >= 2) {
        // Receiver let it bounce twice: hitter wins the point.
        awardPoint(state.lastHitter, "double-bounce");
        return;
      }
      return;
    }

    // Ball fell below the table: out, or past a napping receiver.
    if (ball.y < -5) {
      if (state.bounces === 0) {
        awardPoint(other(state.lastHitter), "out");
      } else {
        awardPoint(state.lastHitter, "missed");
      }
      return;
    }

    // Paddle hits.
    for (let i = 0; i < 2; i++) {
      const player = i + 1;
      const paddle = state.paddles[i];
      const toward = player === 1 ? ball.vz > 0 : ball.vz < 0;
      if (!toward || state.lastHitter === player) continue;
      const dz = player === 1 ? ball.z - paddle.z : paddle.z - ball.z;
      if (dz < -HIT_WINDOW_BEFORE || dz > HIT_WINDOW_AFTER) continue;
      if (Math.abs(ball.x - paddle.x) > PADDLE_REACH_X) continue;
      if (ball.y > PADDLE_REACH_Y || ball.y < -1) continue;
      if (player === 2 && ai) {
        // AI shot selection: place across the width, wider when aggressive.
        const spread = (TABLE.WIDTH / 2 - 0.5) * (0.45 + ai.aggression * 0.5);
        strike(
          2,
          ai.aim(state, rng),
          0,
          ai.error,
          (rng() * 2 - 1) * spread
        );
      } else {
        const aim = player === 1 ? input.p1aim : input.p2aim;
        const steer = (player === 1 ? input.p1vx : input.p2vx) * 0.05;
        strike(player, aim, steer, 0);
      }
      return;
    }

    // Ball escaped past a paddle plane entirely. If it never bounced it
    // was sailing long — hitter's fault; otherwise the receiver missed.
    if (Math.abs(ball.z) > TABLE.PADDLE_Z + 2.5) {
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

/** Build an AI config from a difficulty spec. */
export function makeAI({ speed, error, reactDelay, aggression }) {
  return {
    speed,
    error,
    reactDelay,
    aggression,
    /** Pick shot loft: aggressive opponents drive flat and deep. */
    aim(state, rng) {
      return rng() < aggression ? -0.7 + rng() * 0.4 : -0.1 + rng() * 0.7;
    },
  };
}
