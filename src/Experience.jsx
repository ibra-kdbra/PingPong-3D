import { Canvas } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import { useEffect } from "react";
import Scene from "./components/Scene.jsx";
import HUD from "./ui/HUD.jsx";
import Screens from "./ui/Screens.jsx";
import { useStore } from "./game/store.js";
import { GitHubIcon, StarIcon } from "./ui/icons.jsx";

function useKeyboardShortcuts() {
  const { togglePause, toggleMute } = useStore((state) => state.api);
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.repeat) return;
      const key = event.key.toLowerCase();
      if (key === "p" || key === "escape") togglePause();
      if (key === "m") toggleMute();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [togglePause, toggleMute]);
}

export default function Experience() {
  useKeyboardShortcuts();
  const quality = useStore((state) => state.quality);
  const phase = useStore((state) => state.phase);
  const { degradeQuality } = useStore((state) => state.api);
  const inGame = phase === "playing" || phase === "paused";

  return (
    <>
      <Canvas
        shadows={quality === "high"}
        dpr={quality === "high" ? [1, 1.75] : 1}
        gl={{ powerPreference: "high-performance", stencil: false }}
        camera={{ fov: 50, position: [0, 5, 12] }}
      >
        {/* Degrade once and stay there: dropping shadows/particles/dpr is
            better than oscillating between pretty and stuttery. */}
        <PerformanceMonitor bounds={() => [40, 60]} onDecline={degradeQuality} />
        <Scene />
      </Canvas>
      <HUD />
      <Screens />
      <a
        className={inGame ? "github github-play" : "github"}
        href="https://github.com/ibra-kdbra/PingPong-3D"
        target="_blank"
        rel="noreferrer"
        title="Star PingPong-3D on GitHub"
      >
        <GitHubIcon />
        <span className="gh-repo">
          <span className="gh-owner">ibra-kdbra&thinsp;/&thinsp;</span>
          PingPong-3D
        </span>
        <span className="gh-star">
          <StarIcon />
          Star
        </span>
      </a>
    </>
  );
}
