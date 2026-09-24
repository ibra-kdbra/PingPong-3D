import { useEffect } from "react";
import { create } from "zustand";
import { getPads, readPad, mergePads } from "../game/gamepad.js";
import { useStore } from "../game/store.js";

/**
 * Connected controllers, for the parts of the UI that describe controls.
 * `ids` is in connection order, so ids[1] is player 2's in two-player.
 */
export const usePadStatus = create(() => ({ count: 0, ids: [] }));

/** Hold a direction this long before it repeats, then repeat this fast. */
const NAV_DELAY = 0.35;
const NAV_REPEAT = 0.12;
const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary, [tabindex]:not([tabindex="-1"])';

/** What a controller can reach: the controls of the screen on show. */
function focusables() {
  const screen = document.querySelector(".screen");
  if (!screen) return [];
  return [...screen.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
}

/** Where focus lands first: the screen's marked default, else its main action. */
function preferred(list) {
  return (
    list.find((el) => el.matches("[data-pad-default]")) ||
    list.find((el) => el.matches(".btn-primary")) ||
    list[0]
  );
}

/** Controller navigation shows a focus ring even though no key was pressed. */
function markPad() {
  document.body.classList.add("pad-nav");
}

function step(dir) {
  const list = focusables();
  if (list.length === 0) return;
  const i = list.indexOf(document.activeElement);
  const next = i < 0 ? preferred(list) : list[(i + dir + list.length) % list.length];
  next.focus();
}

function press() {
  const list = focusables();
  const el = document.activeElement;
  // Nothing chosen yet: the first press shows where you are, the next one acts.
  if (list.includes(el)) el.click();
  else preferred(list)?.focus();
}

function goBack() {
  document.querySelector(".screen [data-pad-back]")?.click();
}

/**
 * Controller buttons outside of play: Start pauses and resumes, Back
 * mutes, and on every menu the D-pad or left stick moves between
 * buttons, A presses and B goes back. Play itself is read in the 3D scene
 * (PadInput); this runs on its own animation frame so it works on screens
 * where nothing 3D is listening.
 *
 * A controller that disconnects mid-point pauses the game, so a flat
 * battery doesn't cost the rally.
 */
export function usePadShortcuts() {
  useEffect(() => {
    let raf = 0;
    let prev = {};
    let lastIds = "";
    const nav = { dir: 0, next: 0 };

    const tick = (t) => {
      raf = requestAnimationFrame(tick);
      const pads = getPads();
      const ids = pads.map((gp) => gp.id);
      const key = ids.join("\n");
      if (key !== lastIds) {
        const lost = ids.length < usePadStatus.getState().count;
        lastIds = key;
        usePadStatus.setState({ count: ids.length, ids });
        if (lost && useStore.getState().phase === "playing") useStore.getState().api.togglePause();
      }
      const snap = mergePads(pads.map(readPad));
      if (!snap) {
        prev = {};
        nav.dir = 0;
        return;
      }
      const now = t / 1000;
      const edge = (k) => snap[k] && !prev[k];
      const { phase, api } = useStore.getState();

      if (edge("start")) {
        markPad();
        if (phase === "playing" || phase === "paused") api.togglePause();
        else press();
      }
      if (edge("back")) api.toggleMute();

      if (phase === "playing") {
        nav.dir = 0;
      } else {
        const dir =
          snap.down || snap.right || snap.ly < -0.5 || snap.lx > 0.5 ? 1
          : snap.up || snap.left || snap.ly > 0.5 || snap.lx < -0.5 ? -1
          : 0;
        if (dir !== nav.dir) {
          nav.dir = dir;
          if (dir) {
            markPad();
            step(dir);
            nav.next = now + NAV_DELAY;
          }
        } else if (dir && now >= nav.next) {
          step(dir);
          nav.next = now + NAV_REPEAT;
        }
        if (edge("a")) {
          markPad();
          press();
        }
        if (edge("b")) {
          markPad();
          goBack();
        }
      }
      prev = { a: snap.a, b: snap.b, start: snap.start, back: snap.back };
    };
    raf = requestAnimationFrame(tick);

    // The mouse is back: no more forced focus ring. Only a real move counts;
    // browsers send motionless mousemoves when the page changes under a
    // resting cursor, which is exactly when a new screen has just appeared.
    const unmark = () => document.body.classList.remove("pad-nav");
    const onMove = (e) => {
      if (e.movementX || e.movementY) unmark();
    };
    window.addEventListener("pointerdown", unmark);
    window.addEventListener("mousemove", onMove);

    // A new screen while navigating by controller starts on its main action.
    const unsub = useStore.subscribe((state, before) => {
      if (state.phase === before.phase || state.phase === "playing") return;
      if (!document.body.classList.contains("pad-nav")) return;
      requestAnimationFrame(() => {
        const list = focusables();
        if (!list.includes(document.activeElement)) preferred(list)?.focus();
      });
    });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointerdown", unmark);
      window.removeEventListener("mousemove", onMove);
      unsub();
    };
  }, []);
}
