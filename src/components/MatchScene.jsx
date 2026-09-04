import { useFrame } from "@react-three/fiber";
import { Trail } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import { createMatch, makeAI, TABLE, BALL_RADIUS, TECH } from "../game/match.js";
import { STAGES, VERSUS_THEME } from "../game/stages.js";
import { useStore } from "../game/store.js";
import { audio } from "../game/audio.js";
import { kick } from "../game/fx.js";
import { net } from "../net/current.js";

const HALF_W = TABLE.WIDTH / 2;
const HALF_L = TABLE.LENGTH / 2;
/** How far the mouse drives the player paddle sideways. */
const P1_RANGE = 6.5;
const P2_SPEED = 15;
/** Impact ring lifetime in seconds. */
const RING_LIFE = 0.32;
/** Fixed simulation step (also what online play synchronises on). */
const STEP = 1 / 120;
const MAX_STEPS_PER_FRAME = 8;
/** Paddle height range driven by pointer height. */
const PADDLE_Y_MIN = 0.8;
const PADDLE_Y_MAX = 2.8;

function Table({ theme, netHeight }) {
  return (
    <group>
      {/* Top */}
      <mesh position={[0, -0.16, 0]} receiveShadow>
        <boxGeometry args={[TABLE.WIDTH, 0.3, TABLE.LENGTH]} />
        <meshStandardMaterial color={theme.table} roughness={0.85} />
      </mesh>
      {/* Boundary + centre lines */}
      {[
        { pos: [-HALF_W + 0.08, 0.001, 0], size: [0.12, 0.01, TABLE.LENGTH] },
        { pos: [HALF_W - 0.08, 0.001, 0], size: [0.12, 0.01, TABLE.LENGTH] },
        { pos: [0, 0.001, -HALF_L + 0.08], size: [TABLE.WIDTH, 0.01, 0.12] },
        { pos: [0, 0.001, HALF_L - 0.08], size: [TABLE.WIDTH, 0.01, 0.12] },
        { pos: [0, 0.001, 0], size: [0.06, 0.01, TABLE.LENGTH] },
      ].map((line, i) => (
        <mesh key={i} position={line.pos}>
          <boxGeometry args={line.size} />
          <meshBasicMaterial color="#e8ecf8" />
        </mesh>
      ))}
      {/* Net */}
      <mesh position={[0, netHeight / 2, 0]}>
        <boxGeometry args={[TABLE.WIDTH + 0.6, netHeight, 0.04]} />
        <meshStandardMaterial color="#10131f" transparent opacity={0.72} />
      </mesh>
      <mesh position={[0, netHeight - 0.03, 0]}>
        <boxGeometry args={[TABLE.WIDTH + 0.6, 0.07, 0.06]} />
        <meshBasicMaterial color="#e8ecf8" />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (HALF_W + 0.35), netHeight / 2, 0]}>
          <cylinderGeometry args={[0.06, 0.06, netHeight, 8]} />
          <meshStandardMaterial color="#39415f" />
        </mesh>
      ))}
      {/* Legs */}
      {[
        [-HALF_W + 0.6, -HALF_L + 1],
        [HALF_W - 0.6, -HALF_L + 1],
        [-HALF_W + 0.6, HALF_L - 1],
        [HALF_W - 0.6, HALF_L - 1],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, -2.6, z]}>
          <boxGeometry args={[0.25, 4.9, 0.25]} />
          <meshStandardMaterial color="#232a44" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function PaddleMesh({ color }) {
  return (
    <group rotation={[Math.PI / 2.08, 0, 0]} scale={[0.85, 0.85, 0.85]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.95, 0.95, 0.14, 24]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      <mesh position={[0, -1.25, 0]} castShadow>
        <boxGeometry args={[0.34, 0.9, 0.16]} />
        <meshStandardMaterial color="#b98a4e" roughness={0.8} />
      </mesh>
    </group>
  );
}

/**
 * Runs the whole match: reads inputs, steps the engine, writes transforms
 * to the meshes, and forwards engine events to store + audio. All hot-path
 * data lives in refs; React re-renders only on phase/point changes.
 */
export default function MatchScene() {
  const mode = useStore((state) => state.mode);
  const stageIndex = useStore((state) => state.stage);
  const { matchPoint, matchOver, rallyTick, flash, setOnline } = useStore(
    (state) => state.api
  );
  const stage = mode === "adventure" ? STAGES[stageIndex] : null;
  const theme = stage ? stage.theme : VERSUS_THEME;
  const physics = stage?.physics ?? {};
  const online = mode === "online";
  const isGuest = online && net.role === "guest";
  const isHost = online && net.role === "host";
  const session = online ? net.session : null;
  /** Which engine player index is "me" (0 or 1). */
  const me = isGuest ? 1 : 0;

  const match = useMemo(
    () =>
      isGuest
        ? null
        : isHost
          ? net.match
          : createMatch({
              ai: stage ? makeAI(stage.ai) : null,
              winScore: stage ? stage.winScore : 7,
              ...physics,
            }),
    // A new engine per mount; MatchScene is keyed by matchKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const netHeight = match ? match.state.config.netHeight : session.state.cfg.netHeight;
  const guestRally = useRef(0);
  const latencySync = useRef(0);

  const ballRef = useRef();
  const shadowRef = useRef();
  const ringRef = useRef();
  const p1Ref = useRef();
  const p2Ref = useRef();
  const events = useRef(new Array(16)).current;
  const input = useRef({
    p1x: 0, p1vx: 0, p1aim: 0, p1spin: 0, p1tech: TECH.DRIVE,
    p2x: 0, p2vx: 0, p2aim: 0.1, p2spin: 0, p2tech: TECH.DRIVE,
  }).current;
  const keys = useRef({
    left: false, right: false, up: false, down: false,
    p2brush: false, p2loop: false, p2chop: false,
    space: false, lmb: false, rmb: false,
  });
  const prevP1 = useRef(0);
  const ringAge = useRef(RING_LIFE);
  const accumulator = useRef(0);
  /** Swing lunge energy per paddle, decays each frame. */
  const lunge = useRef([0, 0]);
  const p2y = useRef(1.1);

  // Input: pointer buttons (P1 techniques), keyboard (P1 chop, P2 in versus).
  useEffect(() => {
    const k = keys.current;
    const setKey = (e, v) => {
      const key = e.key.toLowerCase();
      if (key === " ") {
        k.space = v;
        if (useStore.getState().phase === "playing") e.preventDefault();
      }
      if (mode !== "versus") return;
      if (key === "a" || key === "arrowleft") k.left = v;
      if (key === "d" || key === "arrowright") k.right = v;
      if (key === "w" || key === "arrowup") k.up = v;
      if (key === "s" || key === "arrowdown") k.down = v;
      if (key === "shift") k.p2brush = v;
      if (key === "e") k.p2loop = v;
      if (key === "q") k.p2chop = v;
    };
    const down = (e) => setKey(e, true);
    const up = (e) => setKey(e, false);
    const pointerDown = (e) => {
      if (e.button === 0) k.lmb = true;
      if (e.button === 2) k.rmb = true;
    };
    const pointerUp = (e) => {
      if (e.button === 0) k.lmb = false;
      if (e.button === 2) k.rmb = false;
    };
    const noMenu = (e) => {
      if (useStore.getState().phase === "playing") e.preventDefault();
    };
    // Don't let a focused menu button eat Space/Enter during play.
    document.activeElement?.blur?.();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("pointerdown", pointerDown);
    window.addEventListener("pointerup", pointerUp);
    window.addEventListener("contextmenu", noMenu);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("pointerdown", pointerDown);
      window.removeEventListener("pointerup", pointerUp);
      window.removeEventListener("contextmenu", noMenu);
    };
  }, [mode, keys]);

  const ring = (x, y, z) => {
    if (!ringRef.current) return;
    ringRef.current.position.set(x, y, z);
    ringAge.current = 0;
  };

  useFrame((state, rawDelta) => {
    const game = useStore.getState();
    const targetX = state.pointer.x * P1_RANGE;
    if (game.phase !== "playing") {
      // Track the paddle even while paused so the first resumed frame
      // doesn't see a huge position delta as swing velocity.
      prevP1.current = targetX;
      accumulator.current = 0;
      return;
    }
    const dt = Math.min(rawDelta, 1 / 30);
    const k = keys.current;

    // Player 1: mouse. x position, swing velocity, loft from mouse height;
    // hold the left button while swinging to brush (curve), right button
    // to loop, Space to chop.
    input.p1vx =
      dt > 0
        ? Math.max(-40, Math.min(40, (targetX - prevP1.current) / dt))
        : 0;
    prevP1.current = targetX;
    input.p1x = targetX;
    input.p1aim = Math.max(-1, Math.min(1, state.pointer.y * 1.4));
    input.p1spin = k.lmb
      ? Math.sign(input.p1vx) * Math.min(Math.abs(input.p1vx) / 22, 1)
      : 0;
    input.p1tech = k.rmb ? TECH.LOOP : k.space ? TECH.CHOP : TECH.DRIVE;

    // Player 2 (versus): keyboard. Shift while moving brushes, E loops,
    // Q chops.
    if (mode === "versus") {
      const vx = (k.right ? P2_SPEED : 0) - (k.left ? P2_SPEED : 0);
      input.p2x = Math.max(-P1_RANGE, Math.min(P1_RANGE, input.p2x + vx * dt));
      input.p2vx = vx;
      input.p2aim = Math.max(
        -1,
        Math.min(1, input.p2aim + ((k.up ? 1 : 0) - (k.down ? 1 : 0)) * dt * 2)
      );
      input.p2spin = k.p2brush && vx !== 0 ? Math.sign(vx) : 0;
      input.p2tech = k.p2loop ? TECH.LOOP : k.p2chop ? TECH.CHOP : TECH.DRIVE;
    }

    let ball;
    let paddles;
    let n = 0;

    if (isGuest) {
      // Guest: mirror the pointer into world space, send it, advance the
      // shadow, and take events from the host.
      const wx = -input.p1x;
      const wvx = -input.p1vx;
      const wspin = -input.p1spin;
      session.sendInput(wx, wvx, input.p1aim, wspin, input.p1tech);
      session.update(dt);
      ball = session.shadow.ball;
      paddles = session.shadow.paddles;
      // Own paddle is predicted locally: no waiting for the round trip.
      paddles[1].x = wx;
      paddles[1].vx = wvx;
      n = session.drainEvents(events);
      if (session.state.rally > guestRally.current) guestRally.current = session.state.rally;
    } else {
      if (isHost) session.applyRemoteInput(input);
      // Fixed-step simulation: identical physics at any frame rate.
      accumulator.current += dt;
      let steps = 0;
      while (accumulator.current >= STEP && steps < MAX_STEPS_PER_FRAME) {
        match.step(STEP, input);
        accumulator.current -= STEP;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) accumulator.current = 0;
      ball = match.state.ball;
      paddles = match.state.paddles;
      n = match.drainEvents(events);
      if (isHost) session.afterStep(events, n);
    }

    if (online) {
      latencySync.current += dt;
      if (latencySync.current > 1) {
        latencySync.current = 0;
        const lat = session.state.latency;
        if (Math.abs(lat - useStore.getState().online.latency) > 0.004) setOnline({ latency: lat });
      }
    }
    const scores = match ? match.state.scores : session.state.scores;
    const server = match ? match.state.server : session.state.server;
    const rallyHits = match ? match.state.rallyHits : session.state.rally;
    const bestRally = match ? match.state.bestRally : guestRally.current;
    const myPlayer = me + 1;

    for (let i = 0; i < n; i++) {
      const e = events[i];
      if (e.type === "hit") {
        audio.ping(6 + e.b * 0.25);
        ring(ball.x, ball.y, ball.z);
        rallyTick(rallyHits);
        lunge.current[e.a - 1] = 1;
        if (e.b > 34) {
          audio.smash();
          kick(0.35);
          if (e.a === myPlayer) flash("Smash");
        } else if (e.a === myPlayer && e.c === TECH.LOOP) flash("Loop");
        else if (e.a === myPlayer && e.c === TECH.CHOP) flash("Chop");
        else if (e.a === myPlayer && Math.abs(ball.sx) > 0.6) flash("Curve");
      } else if (e.type === "bounce") {
        audio.ping(2 + e.b * 0.12);
        ring(ball.x, 0.02, ball.z);
      } else if (e.type === "serve") audio.serve();
      else if (e.type === "net") {
        audio.net();
        kick(0.2);
      } else if (e.type === "netcord") {
        audio.netCord();
        flash("Net cord", "Still in play");
      } else if (e.type === "point") {
        kick(0.5);
        matchPoint(e.a, e.b, scores, server);
      } else if (e.type === "over") matchOver(e.a, bestRally);
    }

    // Write transforms.
    if (ballRef.current) {
      const m = ballRef.current;
      m.position.set(ball.x, ball.y, ball.z);
      // Roll with the flight, plus a visible twist from sidespin.
      m.rotation.x -= ball.vz * dt * 1.6;
      m.rotation.z += (ball.vx * 0.6 + ball.sx * 18) * dt;
    }
    if (shadowRef.current) {
      // Blob shadow on the table: reads where the ball will land.
      const s = shadowRef.current;
      const over =
        Math.abs(ball.x) < HALF_W + 0.3 && Math.abs(ball.z) < HALF_L + 0.3;
      s.visible = over && ball.y > 0;
      s.position.set(ball.x, 0.012, ball.z);
      const k = Math.max(0.35, 1 - ball.y * 0.09);
      s.scale.set(k, k, 1);
      s.material.opacity = 0.18 + 0.32 * Math.max(0, 1 - ball.y * 0.12);
    }
    if (ringRef.current) {
      ringAge.current += dt;
      const t = Math.min(ringAge.current / RING_LIFE, 1);
      const r = ringRef.current;
      r.visible = t < 1;
      const k = 0.4 + t * 1.6;
      r.scale.set(k, k, 1);
      r.material.opacity = (1 - t) * 0.7;
    }
    // Paddles: height follows the pointer (P2: the ball), the face opens
    // for lobs/chops and closes for drives/loops, the blade twists for a
    // brush, and each hit lunges the paddle toward the net.
    const decay = Math.max(0, 1 - dt * 7);
    lunge.current[0] *= decay;
    lunge.current[1] *= decay;
    const refs = [p1Ref.current, p2Ref.current];
    const own = refs[me];
    const other = refs[1 - me];
    const dirs = [-1, 1]; // toward the net for player 1 / player 2
    if (own) {
      const y = PADDLE_Y_MIN + ((state.pointer.y + 1) / 2) * (PADDLE_Y_MAX - PADDLE_Y_MIN);
      const sign = me === 0 ? 1 : -1;
      const face =
        sign * (input.p1aim * 0.35 + (input.p1tech === TECH.CHOP ? 0.45 : input.p1tech === TECH.LOOP ? -0.3 : 0));
      own.position.set(paddles[me].x, y, paddles[me].z + dirs[me] * lunge.current[me] * 0.9);
      own.rotation.set(face, -input.p1spin * 0.7 * sign, -paddles[me].vx * 0.012 * sign);
      const sc = 1 + lunge.current[me] * 0.12;
      own.scale.set(sc, sc, sc);
    }
    if (other) {
      const o = 1 - me;
      const sideSign = o === 1 ? -1 : 1;
      const near = sideSign * ball.z < 0 ? Math.max(0, Math.min(1, (sideSign * -ball.z - 2) / 4)) : 0;
      let wantY = near > 0 ? Math.max(PADDLE_Y_MIN, Math.min(PADDLE_Y_MAX, ball.y)) : 1.1;
      let face2 = 0;
      let twist = 0;
      if (mode === "versus") {
        wantY = PADDLE_Y_MIN + ((input.p2aim + 1) / 2) * (PADDLE_Y_MAX - PADDLE_Y_MIN) * 0.6 + 0.3;
        face2 = -input.p2aim * 0.35 + (input.p2tech === TECH.CHOP ? -0.45 : input.p2tech === TECH.LOOP ? 0.3 : 0);
        twist = input.p2spin * 0.7;
      }
      p2y.current += (wantY - p2y.current) * Math.min(1, dt * 8);
      other.position.set(paddles[o].x, p2y.current, paddles[o].z + dirs[o] * lunge.current[o] * 0.9);
      other.rotation.set(face2, twist, paddles[o].vx * 0.012 * (o === 1 ? 1 : -1));
      const sc = 1 + lunge.current[o] * 0.12;
      other.scale.set(sc, sc, sc);
    }
  });

  return (
    <group>
      <Table theme={theme} netHeight={netHeight} />
      <group ref={p1Ref} position={[0, 1.1, TABLE.PADDLE_Z]}>
        <PaddleMesh color="#c8452f" />
      </group>
      <group ref={p2Ref} position={[0, 1.1, -TABLE.PADDLE_Z]}>
        <PaddleMesh color="#23283f" />
      </group>
      <Trail
        width={1.1}
        length={5}
        color={theme.accent}
        attenuation={(t) => t * t}
        decay={2.5}
      >
        <mesh ref={ballRef} castShadow position={[0, 2, TABLE.PADDLE_Z]}>
          <sphereGeometry args={[BALL_RADIUS, 24, 24]} />
          <meshStandardMaterial color="#f6f2e8" roughness={0.35} />
        </mesh>
      </Trail>
      {/* Landing shadow */}
      <mesh ref={shadowRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <circleGeometry args={[BALL_RADIUS * 1.4, 20]} />
        <meshBasicMaterial color="#05070f" transparent opacity={0.4} depthWrite={false} />
      </mesh>
      {/* Impact ring */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.32, 0.42, 28]} />
        <meshBasicMaterial color={theme.accent} transparent opacity={0.6} depthWrite={false} />
      </mesh>
      {/* Grounding: faint floor far below the table */}
      <mesh position={[0, -5.2, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[160, 160]} />
        <meshStandardMaterial color={theme.bg} roughness={1} />
      </mesh>
      <gridHelper
        args={[60, 40, theme.grid[0], theme.grid[1]]}
        position={[0, -5.15, 0]}
      />
    </group>
  );
}
