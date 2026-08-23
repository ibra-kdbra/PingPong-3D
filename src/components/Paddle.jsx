import { useBox } from "@react-three/cannon";
import { useFrame, useLoader } from "@react-three/fiber";
import { useRef } from "react";
import { MathUtils } from "three";
import { DRACOLoader } from "three-stdlib/loaders/DRACOLoader";
import { GLTFLoader } from "three-stdlib/loaders/GLTFLoader";
import { GROUP_BALL, GROUP_PADDLE } from "../game/collision.js";
import { useStore } from "../game/store.js";
import Text from "./Text.jsx";

const extensions = (loader) => {
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath("./draco-gltf/");
  loader.setDRACOLoader(dracoLoader);
};

/** Horizontal / vertical reach of the paddle, in world units. */
const REACH_X = 10;
const REACH_Y = 5;

export default function Paddle() {
  const { nodes, materials } = useLoader(
    GLTFLoader,
    "./models/pingpong.glb",
    extensions
  );
  const { pong } = useStore((state) => state.api);
  const welcome = useStore(
    (state) => state.phase === "menu" || state.phase === "map"
  );
  const score = useStore((state) => state.score);
  const model = useRef();
  const [ref, api] = useBox(() => ({
    type: "Kinematic",
    args: [3.4, 1, 3.5],
    collisionFilterGroup: GROUP_PADDLE,
    collisionFilterMask: GROUP_BALL,
    onCollide: (e) => pong(e.contact.impactVelocity),
  }));

  // Smoothed tilt + previous position, used to feed the physics engine a
  // real velocity so ball impacts inherit the paddle's motion (this is what
  // makes "smashing" the ball actually work).
  const tilt = useRef(0);
  const prev = useRef([0, 0]);

  useFrame((state, delta) => {
    const x = state.pointer.x * REACH_X;
    const y = state.pointer.y * REACH_Y;
    tilt.current = MathUtils.lerp(
      tilt.current,
      (state.pointer.x * Math.PI) / 5,
      0.2
    );

    if (delta > 0) {
      api.velocity.set(
        (x - prev.current[0]) / delta,
        (y - prev.current[1]) / delta,
        0
      );
    }
    prev.current = [x, y];

    api.position.set(x, y, 0);
    api.rotation.set(0, 0, tilt.current);

    if (!model.current) return;
    model.current.rotation.x = MathUtils.lerp(
      model.current.rotation.x,
      welcome ? Math.PI / 2 : 0,
      0.2
    );
    model.current.rotation.y = tilt.current;
  });

  return (
    <mesh ref={ref} dispose={null}>
      <group
        ref={model}
        position={[-0.05, 0.37, 0.3]}
        scale={[0.15, 0.15, 0.15]}
      >
        <Text
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 1, 2]}
          count={score.toString()}
        />
        <group rotation={[1.88, -0.35, 2.32]} scale={[2.97, 2.97, 2.97]}>
          <primitive object={nodes.Bone} />
          <primitive object={nodes.Bone003} />
          <primitive object={nodes.Bone006} />
          <primitive object={nodes.Bone010} />
          <skinnedMesh
            castShadow
            receiveShadow
            material={materials.glove}
            material-roughness={1}
            geometry={nodes.arm.geometry}
            skeleton={nodes.arm.skeleton}
          />
        </group>
        <group rotation={[0, -0.04, 0]} scale={[141.94, 141.94, 141.94]}>
          <mesh
            castShadow
            receiveShadow
            material={materials.wood}
            geometry={nodes.mesh.geometry}
          />
          <mesh
            castShadow
            receiveShadow
            material={materials.side}
            geometry={nodes.mesh_1.geometry}
          />
          <mesh
            castShadow
            receiveShadow
            material={materials.foam}
            geometry={nodes.mesh_2.geometry}
          />
          <mesh
            castShadow
            receiveShadow
            material={materials.lower}
            geometry={nodes.mesh_3.geometry}
          />
          <mesh
            castShadow
            receiveShadow
            material={materials.upper}
            geometry={nodes.mesh_4.geometry}
          />
        </group>
      </group>
    </mesh>
  );
}
