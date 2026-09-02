import { Physics } from "@react-three/cannon";
import { useFrame } from "@react-three/fiber";
import { Sparkles, Stars } from "@react-three/drei";
import { Suspense, useEffect } from "react";
import { MathUtils } from "three";
import { STAGES, VERSUS_THEME } from "../game/stages.js";
import { useStore, useLevel } from "../game/store.js";
import { fx } from "../game/fx.js";
import Arena from "./Arena.jsx";
import Ball from "./Ball.jsx";
import MatchScene from "./MatchScene.jsx";
import Paddle from "./Paddle.jsx";

/** Subtle mouse parallax around a per-mode camera base, plus impact shake. */
function CameraRig({ base, look }) {
  useFrame((state, delta) => {
    const { camera, pointer } = state;
    camera.position.x = MathUtils.lerp(
      camera.position.x,
      base[0] + pointer.x * 1.2,
      0.04
    );
    camera.position.y = MathUtils.lerp(
      camera.position.y,
      base[1] + pointer.y * 0.7,
      0.04
    );
    camera.position.z = MathUtils.lerp(camera.position.z, base[2], 0.08);
    camera.lookAt(look[0], look[1], look[2]);
    if (fx.shake > 0.001) {
      const s = fx.shake * 0.25;
      camera.position.x += (Math.random() - 0.5) * s;
      camera.position.y += (Math.random() - 0.5) * s;
      fx.shake *= Math.max(0, 1 - delta * 9);
    }
  });
  return null;
}

function Environment({ theme, accentLight }) {
  const high = useStore((state) => state.quality === "high");
  return (
    <>
      <color attach="background" args={[theme.bg]} />
      <fog attach="fog" args={[theme.bg, 25, 90]} />
      {/* three r155+ uses physical light units; decay 0 + ~pi-scaled
          intensities reproduce the pre-upgrade look. */}
      <ambientLight intensity={1.6} />
      <pointLight position={[-10, -10, -10]} intensity={1.6} decay={0} />
      <pointLight
        position={[0, 9, -4]}
        intensity={1.6}
        decay={0}
        color={accentLight}
      />
      <spotLight
        position={[10, 14, 10]}
        angle={0.35}
        penumbra={1}
        intensity={Math.PI}
        decay={0}
        castShadow={high}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0001}
      />
      <Stars
        radius={90}
        depth={40}
        count={high ? 1500 : 600}
        factor={4}
        fade
        speed={0.5}
      />
      {high && (
        <Sparkles
          count={40}
          scale={[26, 12, 14]}
          position={[0, 4, -4]}
          size={2}
          speed={0.3}
          color={accentLight}
        />
      )}
    </>
  );
}

function KeepUpWorld() {
  const phase = useStore((state) => state.phase);
  const ballKey = useStore((state) => state.ballKey);
  const level = useLevel();
  const ballActive = phase === "playing" || phase === "paused";

  return (
    <Physics
      isPaused={phase === "paused"}
      iterations={20}
      tolerance={0.0001}
      defaultContactMaterial={{
        contactEquationRelaxation: 1,
        contactEquationStiffness: 1e7,
        friction: 0.9,
        frictionEquationRelaxation: 2,
        frictionEquationStiffness: 1e7,
        restitution: 0.75,
      }}
      gravity={[0, level.gravity, 0]}
      allowSleep={false}
    >
      <Arena />
      {ballActive && <Ball key={`${ballKey}`} />}
      <Suspense fallback={null}>
        <Paddle />
      </Suspense>
    </Physics>
  );
}

export default function Scene() {
  const mode = useStore((state) => state.mode);
  const phase = useStore((state) => state.phase);
  const matchKey = useStore((state) => state.matchKey);
  const stageIndex = useStore((state) => state.stage);
  const level = useLevel();
  // Any match reset clears leftover shake.
  useEffect(() => {
    fx.shake = 0;
  }, [matchKey]);

  const inMatch =
    mode !== "keepup" &&
    (phase === "playing" || phase === "paused" || phase === "matchover");
  const theme = inMatch
    ? mode === "adventure"
      ? STAGES[stageIndex].theme
      : VERSUS_THEME
    : level;

  return (
    <>
      <Environment theme={theme} accentLight={theme.accent} />
      {inMatch ? (
        <>
          <CameraRig base={[0, 7.5, 16.5]} look={[0, 0.5, -2]} />
          <MatchScene key={matchKey} />
        </>
      ) : (
        <>
          <CameraRig base={[0, 5, 12]} look={[0, 2, 0]} />
          <KeepUpWorld />
        </>
      )}
    </>
  );
}
