import { useFrame } from "@react-three/fiber";
import { Trail } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import { createMatch, makeAI, TABLE, BALL_RADIUS } from "../game/match.js";
import { STAGES, VERSUS_THEME } from "../game/stages.js";
import { useStore } from "../game/store.js";
import { audio } from "../game/audio.js";

const HALF_W = TABLE.WIDTH / 2;
const HALF_L = TABLE.LENGTH / 2;
/** How far the mouse drives the player paddle sideways. */
const P1_RANGE = 6.5;
const P2_SPEED = 15;

function Table({ theme }) {
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
      <mesh position={[0, TABLE.NET_HEIGHT / 2, 0]}>
        <boxGeometry args={[TABLE.WIDTH + 0.6, TABLE.NET_HEIGHT, 0.04]} />
        <meshStandardMaterial color="#10131f" transparent opacity={0.72} />
      </mesh>
      <mesh position={[0, TABLE.NET_HEIGHT - 0.03, 0]}>
        <boxGeometry args={[TABLE.WIDTH + 0.6, 0.07, 0.06]} />
        <meshBasicMaterial color="#e8ecf8" />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (HALF_W + 0.35), TABLE.NET_HEIGHT / 2, 0]}>
          <cylinderGeometry args={[0.06, 0.06, TABLE.NET_HEIGHT, 8]} />
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
  const { matchPoint, matchOver } = useStore((state) => state.api);
  const stage = mode === "adventure" ? STAGES[stageIndex] : null;
  const theme = stage ? stage.theme : VERSUS_THEME;

  const match = useMemo(
    () =>
      createMatch({
        ai: stage ? makeAI(stage.ai) : null,
        winScore: stage ? stage.winScore : 7,
      }),
    // A new engine per mount; MatchScene is keyed by matchKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const ballRef = useRef();
  const p1Ref = useRef();
  const p2Ref = useRef();
  const events = useRef(new Array(16)).current;
  const input = useRef({
    p1x: 0,
    p1vx: 0,
    p1aim: 0,
    p2x: 0,
    p2vx: 0,
    p2aim: 0.1,
  }).current;
  const keys = useRef({ left: false, right: false, up: false, down: false });
  const prevP1 = useRef(0);

  // P2 keyboard controls (versus mode).
  useEffect(() => {
    if (mode !== "versus") return;
    const down = (e) => setKey(e, true);
    const up = (e) => setKey(e, false);
    const setKey = (e, v) => {
      const k = e.key.toLowerCase();
      if (k === "a" || k === "arrowleft") keys.current.left = v;
      if (k === "d" || k === "arrowright") keys.current.right = v;
      if (k === "w" || k === "arrowup") keys.current.up = v;
      if (k === "s" || k === "arrowdown") keys.current.down = v;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [mode, keys]);

  useFrame((state, rawDelta) => {
    const game = useStore.getState();
    const targetX = state.pointer.x * P1_RANGE;
    if (game.phase !== "playing") {
      // Track the paddle even while paused so the first resumed frame
      // doesn't see a huge position delta as swing velocity.
      prevP1.current = targetX;
      return;
    }
    const dt = Math.min(rawDelta, 1 / 30);

    // Player 1: mouse. x position, swing velocity, loft from mouse height.
    input.p1vx =
      dt > 0
        ? Math.max(-40, Math.min(40, (targetX - prevP1.current) / dt))
        : 0;
    prevP1.current = targetX;
    input.p1x = targetX;
    input.p1aim = Math.max(-1, Math.min(1, state.pointer.y * 1.4));

    // Player 2 (versus): keyboard.
    if (mode === "versus") {
      const k = keys.current;
      const vx = (k.right ? P2_SPEED : 0) - (k.left ? P2_SPEED : 0);
      input.p2x = Math.max(-P1_RANGE, Math.min(P1_RANGE, input.p2x + vx * dt));
      input.p2vx = vx;
      input.p2aim = Math.max(
        -1,
        Math.min(1, input.p2aim + ((k.up ? 1 : 0) - (k.down ? 1 : 0)) * dt * 2)
      );
    }

    match.step(dt, input);

    const n = match.drainEvents(events);
    for (let i = 0; i < n; i++) {
      const e = events[i];
      if (e.type === "hit") audio.ping(6 + e.b * 0.25);
      else if (e.type === "bounce") audio.ping(3);
      else if (e.type === "serve") audio.serve();
      else if (e.type === "net") audio.net();
      else if (e.type === "point")
        matchPoint(e.a, e.b, match.state.scores, match.state.server);
      else if (e.type === "over") matchOver(e.a);
    }

    // Write transforms.
    const { ball, paddles } = match.state;
    if (ballRef.current) ballRef.current.position.set(ball.x, ball.y, ball.z);
    if (p1Ref.current) {
      p1Ref.current.position.set(paddles[0].x, 1.1, paddles[0].z);
      p1Ref.current.rotation.z = -paddles[0].vx * 0.012;
    }
    if (p2Ref.current) {
      p2Ref.current.position.set(paddles[1].x, 1.1, paddles[1].z);
      p2Ref.current.rotation.z = paddles[1].vx * 0.012;
    }
  });

  return (
    <group>
      <Table theme={theme} />
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
