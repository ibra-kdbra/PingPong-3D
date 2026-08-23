import { usePlane } from "@react-three/cannon";
import { GROUP_BALL, GROUP_STATIC } from "../game/collision.js";
import { useStore, useLevel } from "../game/store.js";

/**
 * The play area: a themed backdrop and tilted neon grid, plus the physics
 * boundaries — the losing ground plane below, and invisible side/back/front
 * walls that keep the ball inside the visible arena so rallies stay playable.
 */

function ContactGround() {
  const { drop } = useStore((state) => state.api);
  return usePlaneBody({
    onCollide: () => drop(),
    position: [0, -10, 0],
    rotation: [-Math.PI / 2, 0, 0],
  });
}

function usePlaneBody(props) {
  const [ref] = usePlane(() => ({
    type: "Static",
    collisionFilterGroup: GROUP_STATIC,
    collisionFilterMask: GROUP_BALL,
    ...props,
  }));
  return <mesh ref={ref} />;
}

function Wall(props) {
  return usePlaneBody(props);
}

export default function Arena() {
  const level = useLevel();
  return (
    <>
      {/* Themed floor glow + neon grid receding into the fog */}
      <mesh position={[0, -10, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial
          color={level.floor}
          roughness={0.9}
          metalness={0.1}
        />
      </mesh>
      <gridHelper
        args={[50, 50, level.grid[0], level.grid[1]]}
        position={[0, -1.1, -4]}
        rotation={[Math.PI / 2.68, 0, 0]}
      />

      {/* Physics bounds */}
      <ContactGround />
      <Wall position={[-11, 0, 0]} rotation={[0, Math.PI / 2, 0]} />
      <Wall position={[11, 0, 0]} rotation={[0, -Math.PI / 2, 0]} />
      <Wall position={[0, 0, -6]} rotation={[0, 0, 0]} />
      <Wall position={[0, 0, 6]} rotation={[0, Math.PI, 0]} />
    </>
  );
}
