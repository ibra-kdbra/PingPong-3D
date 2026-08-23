import { useSphere } from "@react-three/cannon";
import { useFrame, useLoader } from "@react-three/fiber";
import { Trail } from "@react-three/drei";
import { useRef } from "react";
import { TextureLoader } from "three";
import { LEVELS } from "../game/levels.js";
import { useStore } from "../game/store.js";
import ballImg from "/images/cross.jpg";

/**
 * The game ball. Remounted (via key) on every respawn, so the level's
 * ball radius is applied at spawn time. Higher levels add a swirling
 * side-wind force and the ball itself shrinks.
 *
 * Note: body state is read from the mesh matrix (cannon writes transforms
 * there directly) rather than api.position.subscribe — subscriptions race
 * with body removal in the physics worker when the ball remounts.
 */
export default function Ball() {
  const map = useLoader(TextureLoader, ballImg);
  const { drop } = useStore((state) => state.api);
  const level = useStore.getState().level;
  const { ballRadius, accent } = LEVELS[level];

  const spawnX = (Math.random() - 0.5) * 6;
  const [ref, api] = useSphere(() => ({
    args: [ballRadius],
    mass: 1,
    position: [spawnX, 7, 0],
    linearDamping: 0.08,
    angularDamping: 0.2,
  }));

  const time = useRef(0);
  const stillTime = useRef(0);
  const lastPos = useRef(null);

  useFrame((state, delta) => {
    time.current += delta;
    const game = useStore.getState();
    // Wind is read live so a mid-rally level-up applies immediately. Only
    // apply while actually playing: cannon's force accumulator is cleared
    // by world.step(), so forces applied during pause would pile up and
    // launch the ball on resume.
    const wind = LEVELS[game.level].wind;
    if (wind > 0 && game.phase === "playing") {
      api.applyForce(
        [Math.sin(time.current * 0.9) * wind, 0, 0],
        [0, 0, 0]
      );
    }
    if (!ref.current || delta <= 0) return;

    const e = ref.current.matrix.elements;
    const x = e[12];
    const y = e[13];
    const z = e[14];
    // Cannon writes the matrix directly and leaves .position stale; sync it
    // so the drei Trail (which reads .position) follows the real ball.
    ref.current.position.set(x, y, z);

    // Safety net: ground-plane contact normally handles drops, but a very
    // fast ball can tunnel past it.
    if (y < -14 || Math.abs(x) > 40 || Math.abs(z) > 40) {
      drop();
      return;
    }

    // Anti-stall: in real keep-up a settled ball means the rally is dead.
    // If it rests anywhere (e.g. on a motionless paddle) for ~2.5s, count
    // it as lost — this also prevents farming points off a parked paddle.
    const prev = lastPos.current;
    lastPos.current = [x, y, z];
    if (!prev || game.phase !== "playing") {
      stillTime.current = 0;
      return;
    }
    const speed =
      Math.hypot(x - prev[0], y - prev[1], z - prev[2]) / delta;
    if (speed < 1.0) {
      stillTime.current += delta;
      if (stillTime.current > 2.5) {
        stillTime.current = 0;
        drop();
      }
    } else {
      stillTime.current = 0;
    }
  });

  return (
    <Trail
      width={1.6}
      length={7}
      color={accent}
      attenuation={(t) => t * t}
      decay={2}
    >
      <mesh castShadow ref={ref}>
        <sphereGeometry args={[ballRadius, 32, 32]} />
        <meshStandardMaterial
          map={map}
          roughness={0.4}
          emissive={accent}
          emissiveIntensity={0.08}
        />
      </mesh>
    </Trail>
  );
}
