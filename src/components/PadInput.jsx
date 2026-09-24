import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { useStore } from "../game/store.js";
import {
  getPads, readPad, assignPads, drivePadPlayer, resetPadPlayer, padPlayers,
} from "../game/gamepad.js";

/**
 * Reads the controllers once a frame, before anything that uses them
 * (priority -1 runs ahead of the default 0 without taking over rendering),
 * and leaves the result in padPlayers for the match, the keep-up paddle
 * and the camera to read.
 *
 * Player 1 switches between mouse and controller by whichever moved last,
 * so picking up either one just works.
 */
export default function PadInput() {
  const last = useRef(null);
  useFrame((state, rawDelta) => {
    const { phase, mode } = useStore.getState();
    const pointer = state.pointer;
    const moved = last.current && (pointer.x !== last.current.x || pointer.y !== last.current.y);
    last.current = { x: pointer.x, y: pointer.y };
    if (phase !== "playing" && phase !== "paused") {
      // Off the table the sticks drive the menus instead.
      resetPadPlayer(padPlayers[0]);
      resetPadPlayer(padPlayers[1]);
      return;
    }
    const [one, two] = assignPads(getPads().map(readPad), mode === "versus");
    if (phase === "paused") {
      // Hold still, except that an unplugged controller lets go now, so
      // the game resumes on the mouse rather than jumping to it.
      if (!one) resetPadPlayer(padPlayers[0]);
      if (!two) resetPadPlayer(padPlayers[1]);
      return;
    }
    const dt = Math.min(rawDelta, 1 / 30);
    const p1 = padPlayers[0];
    if (moved) p1.active = false;
    drivePadPlayer(p1, one, dt, { keepup: mode === "keepup", from: p1.active ? p1 : pointer });
    // Player 2's starting point is wherever the keyboard left the paddle;
    // the match keeps padPlayers[1].x up to date while the keyboard drives.
    drivePadPlayer(padPlayers[1], two, dt, { from: padPlayers[1] });
  }, -1);
  return null;
}
