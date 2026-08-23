import { create } from "zustand";
import { LEVELS, MAX_LEVEL } from "./levels.js";
import { STAGES } from "./stages.js";
import { audio } from "./audio.js";

const BEST_KEY = "pingpong3d.best";
const PROGRESS_KEY = "pingpong3d.adventure";

const load = (key, fallback = 0) => {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
};

const save = (key, value) => {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* private mode etc. — progress just won't persist */
  }
};

/** Minimum impact velocity for a keep-up bounce to count as a hit. */
const MIN_SCORING_VELOCITY = 4;
/** Ignore ground contacts fired within this window of the previous one. */
const DROP_DEBOUNCE_MS = 600;

let bannerSeq = 0;
let lastDropAt = 0;

export const useStore = create((set, get) => {
  const showBanner = (title, sub = "", ms = 1900) => {
    const id = ++bannerSeq;
    set({ banner: { id, title, sub } });
    setTimeout(() => {
      if (get().banner?.id === id) set({ banner: null });
    }, ms);
  };

  const commitBest = () => {
    const state = get();
    if (state.mode !== "keepup") return;
    if (state.score > state.best) {
      save(BEST_KEY, state.score);
      set({ best: state.score });
    }
  };

  return {
    /** 'menu' | 'map' | 'playing' | 'paused' | 'gameover' | 'matchover' */
    phase: "menu",
    /** 'keepup' | 'adventure' | 'versus' */
    mode: "keepup",

    // --- keep-up mode ---
    score: 0,
    best: load(BEST_KEY),
    lives: 3,
    combo: 0,
    maxCombo: 0,
    totalHits: 0,
    level: 0,
    hitsInLevel: 0,
    ballKey: 0,
    newBest: false,

    // --- match modes (adventure / versus) ---
    stage: 0,
    /**
     * Adventure progress: stages [0, unlocked] are playable; stages below
     * `unlocked` are beaten. Reaches STAGES.length once the final stage
     * is beaten (everything conquered).
     */
    unlocked: Math.min(load(PROGRESS_KEY), STAGES.length),
    match: { p1: 0, p2: 0, server: 1 },
    /** Remounts the match scene (fresh engine) when incremented. */
    matchKey: 0,
    /** 0 = in play; 1/2 = winner once the match ends. */
    matchWinner: 0,

    banner: null,
    muted: false,
    /**
     * 'high' | 'low' — degraded automatically by the performance monitor
     * when the frame rate can't keep up (weak GPUs, software rendering).
     */
    quality: "high",

    api: {
      degradeQuality() {
        if (get().quality !== "low") set({ quality: "low" });
      },

      // ---------- navigation ----------
      toMenu() {
        commitBest();
        set({ phase: "menu", banner: null });
      },

      toMap() {
        set({ phase: "map", mode: "adventure", banner: null });
      },

      // ---------- keep-up ----------
      startKeepUp() {
        audio.start();
        set((state) => ({
          mode: "keepup",
          phase: "playing",
          score: 0,
          lives: 3,
          combo: 0,
          maxCombo: 0,
          totalHits: 0,
          level: 0,
          hitsInLevel: 0,
          newBest: false,
          banner: null,
          ballKey: state.ballKey + 1,
        }));
        showBanner("Level 1 — " + LEVELS[0].name, "Keep the ball up");
      },

      /** Keep-up paddle contact, called from physics. */
      pong(velocity) {
        const state = get();
        if (state.phase !== "playing" || state.mode !== "keepup") return;
        audio.ping(velocity);
        if (velocity <= MIN_SCORING_VELOCITY) return;

        const combo = state.combo + 1;
        const level = state.level;
        const points = 10 * (level + 1) + Math.min(combo, 20) * (level + 1);
        const hitsInLevel = state.hitsInLevel + 1;
        const leveledUp =
          level < MAX_LEVEL && hitsInLevel >= LEVELS[level].hits;

        set({
          score: state.score + points,
          combo,
          maxCombo: Math.max(state.maxCombo, combo),
          totalHits: state.totalHits + 1,
          level: leveledUp ? level + 1 : level,
          hitsInLevel: leveledUp ? 0 : hitsInLevel,
        });

        if (leveledUp) {
          audio.levelUp();
          const next = LEVELS[level + 1];
          showBanner(
            `Level ${level + 2} — ${next.name}`,
            next.wind > 0 ? "The wind is picking up" : "Faster now"
          );
        }
      },

      /** Keep-up ball lost. */
      drop() {
        const state = get();
        if (state.phase !== "playing" || state.mode !== "keepup") return;
        const now = performance.now();
        if (now - lastDropAt < DROP_DEBOUNCE_MS) return;
        lastDropAt = now;

        const lives = state.lives - 1;
        if (lives <= 0) {
          audio.gameOver();
          const newBest = state.score > 0 && state.score > state.best;
          const best = Math.max(state.best, state.score);
          if (newBest) save(BEST_KEY, best);
          set({ phase: "gameover", lives: 0, combo: 0, best, newBest });
        } else {
          audio.ballLost();
          set((s) => ({ lives, combo: 0, ballKey: s.ballKey + 1 }));
          showBanner(
            lives === 1 ? "Last ball" : "Ball lost",
            `${lives} ${lives === 1 ? "life" : "lives"} left`
          );
        }
      },

      // ---------- matches ----------
      startStage(index) {
        const state = get();
        if (index > state.unlocked) return;
        audio.start();
        set((s) => ({
          mode: "adventure",
          phase: "playing",
          stage: index,
          match: { p1: 0, p2: 0, server: 1 },
          matchWinner: 0,
          matchKey: s.matchKey + 1,
          banner: null,
        }));
        const stage = STAGES[index];
        showBanner(
          `${stage.name} — vs ${stage.opponent}`,
          `First to ${stage.winScore}`
        );
      },

      startVersus() {
        audio.start();
        set((s) => ({
          mode: "versus",
          phase: "playing",
          match: { p1: 0, p2: 0, server: 1 },
          matchWinner: 0,
          matchKey: s.matchKey + 1,
          banner: null,
        }));
        showBanner("Two players", "P1 mouse · P2 A/D + W/S — first to 7");
      },

      /** Mirror a point from the engine into UI state. */
      matchPoint(winner, reason, scores, server) {
        const state = get();
        if (state.phase !== "playing") return;
        const p1Win = winner === 1;
        audio.point(p1Win);
        const labels = {
          net: "Into the net",
          out: "Out",
          missed: "Clean winner",
          "double-bounce": "Double bounce",
        };
        const who =
          state.mode === "versus"
            ? p1Win
              ? "Point — Player 1"
              : "Point — Player 2"
            : p1Win
              ? "Point — You"
              : `Point — ${STAGES[state.stage].opponent}`;
        showBanner(who, labels[reason] ?? "", 1400);
        set({ match: { p1: scores[0], p2: scores[1], server } });
      },

      matchOver(winner) {
        const state = get();
        if (state.phase !== "playing") return;
        const p1Win = winner === 1;
        if (state.mode === "adventure" && p1Win) {
          audio.matchWin();
          const unlocked = Math.max(state.unlocked, state.stage + 1);
          save(PROGRESS_KEY, unlocked);
          set({ phase: "matchover", matchWinner: winner, unlocked });
        } else {
          if (p1Win) audio.matchWin();
          else audio.gameOver();
          set({ phase: "matchover", matchWinner: winner });
        }
      },

      retryMatch() {
        const state = get();
        if (state.mode === "adventure") get().api.startStage(state.stage);
        else get().api.startVersus();
      },

      nextStage() {
        const state = get();
        if (state.stage + 1 < STAGES.length)
          get().api.startStage(state.stage + 1);
        else get().api.toMap();
      },

      // ---------- shared ----------
      togglePause() {
        const { phase } = get();
        if (phase === "playing") set({ phase: "paused" });
        else if (phase === "paused") set({ phase: "playing" });
      },

      toggleMute() {
        const muted = !get().muted;
        audio.setMuted(muted);
        set({ muted });
      },
    },
  };
});

/** Current keep-up level definition. */
export const useLevel = () => useStore((state) => LEVELS[state.level]);
