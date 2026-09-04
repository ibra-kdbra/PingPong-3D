import { create } from "zustand";
import { LEVELS, MAX_LEVEL } from "./levels.js";
import { STAGES, starsFor } from "./stages.js";
import { audio } from "./audio.js";
import { net, resetNet } from "../net/current.js";
import { makeRoomCode, createPeerHost, createPeerGuest } from "../net/transport.js";
import { createHost, createGuest } from "../net/session.js";
import { createMatch } from "./match.js";

const NAME_KEY = "pingpong3d.name";
const loadName = () => {
  try {
    return localStorage.getItem(NAME_KEY) || "";
  } catch {
    return "";
  }
};

const BEST_KEY = "pingpong3d.best";
const PROGRESS_KEY = "pingpong3d.adventure";
const STARS_KEY = "pingpong3d.stars";

const loadStars = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STARS_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

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
    /** 'menu' | 'map' | 'online' | 'playing' | 'paused' | 'gameover' | 'matchover' */
    phase: "menu",
    /** 'keepup' | 'adventure' | 'versus' | 'online' */
    mode: "keepup",

    /** Online play status (the live connection lives in net/current.js). */
    online: {
      role: null,
      status: "idle", // idle | creating | waiting | joining | connected | error | lost
      code: "",
      error: "",
      note: "",
      peerName: "",
      latency: 0,
      rematch: { me: false, them: false },
      name: loadName(),
    },

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
    /** Star ratings per beaten adventure stage index. */
    stars: loadStars(),
    /** Stars earned by the match that just ended. */
    matchStars: 0,
    /** Strikes in the current rally / longest rally this match. */
    rally: 0,
    bestRally: 0,
    /** Opponent's one-liner after a point ({ id, text }). */
    quote: null,

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
        if (get().mode === "online") resetNet();
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
          matchStars: 0,
          rally: 0,
          bestRally: 0,
          quote: null,
          matchKey: s.matchKey + 1,
          banner: null,
        }));
        const stage = STAGES[index];
        showBanner(
          `${stage.name} — vs ${stage.opponent}`,
          stage.modifier
            ? `${stage.modifier} · first to ${stage.winScore}`
            : index === 0
              ? `First to ${stage.winScore} · hold click while swinging to curve`
              : `First to ${stage.winScore}`
        );
      },

      startVersus() {
        audio.start();
        set((s) => ({
          mode: "versus",
          phase: "playing",
          match: { p1: 0, p2: 0, server: 1 },
          matchWinner: 0,
          matchStars: 0,
          rally: 0,
          bestRally: 0,
          quote: null,
          matchKey: s.matchKey + 1,
          banner: null,
        }));
        showBanner("Two players", "P1 mouse · P2 keyboard — first to 7");
      },

      /** Live rally length, for the HUD counter. */
      rallyTick(hits) {
        set({ rally: hits });
      },

      /** Short in-play callout (net cord, smash…). */
      flash(title, sub = "") {
        showBanner(title, sub, 900);
      },

      /** Mirror a point from the engine into UI state. */
      matchPoint(winner, reason, scores, server) {
        const state = get();
        if (state.phase !== "playing") return;
        const p1Win = winner === 1;
        const meForAudio = state.mode === "online" && state.online.role === "guest" ? 2 : 1;
        audio.point(winner === meForAudio);
        const labels = {
          net: "Into the net",
          out: "Out",
          missed: "Clean winner",
          "double-bounce": "Double bounce",
        };
        const stage = state.mode === "adventure" ? STAGES[state.stage] : null;
        const winScore = stage ? stage.winScore : 7;
        const me = state.mode === "online" && state.online.role === "guest" ? 2 : 1;
        const mine = winner === me;
        const who =
          state.mode === "versus"
            ? p1Win
              ? "Point — Player 1"
              : "Point — Player 2"
            : state.mode === "online"
              ? mine
                ? "Point — You"
                : `Point — ${state.online.peerName || "Them"}`
              : p1Win
                ? "Point — You"
                : `Point — ${stage.opponent}`;
        const [p1, p2] = scores;
        const leaderAtMatchPoint =
          (p1 === winScore - 1 && p2 < winScore - 1) ||
          (p2 === winScore - 1 && p1 < winScore - 1);
        const deuceLike = p1 === winScore - 1 && p2 === winScore - 1;
        let sub = labels[reason] ?? "";
        if (deuceLike) sub = `${sub} · Next point wins`;
        else if (leaderAtMatchPoint) sub = `${sub} · Match point`;
        showBanner(who, sub, 1400);

        // Opponent personality: a one-liner after each point.
        let quote = null;
        if (stage?.lines) {
          const pool = p1Win ? stage.lines.lose : stage.lines.win;
          const text = pool[Math.floor(Math.random() * pool.length)];
          quote = { id: ++bannerSeq, text };
          const id = quote.id;
          setTimeout(() => {
            if (get().quote?.id === id) set({ quote: null });
          }, 2200);
        }
        set({ match: { p1, p2, server }, rally: 0, quote });
      },

      matchOver(winner, bestRally = 0) {
        const state = get();
        if (state.phase !== "playing") return;
        const me = state.mode === "online" && state.online.role === "guest" ? 2 : 1;
        const p1Win = winner === me;
        if (state.mode === "adventure" && p1Win) {
          audio.matchWin();
          const stage = STAGES[state.stage];
          const unlocked = Math.max(state.unlocked, state.stage + 1);
          save(PROGRESS_KEY, unlocked);
          const earned = starsFor(stage, state.match.p1, state.match.p2);
          const stars = { ...state.stars };
          if (earned > (stars[state.stage] || 0)) {
            stars[state.stage] = earned;
            save(STARS_KEY, JSON.stringify(stars));
          }
          set({
            phase: "matchover",
            matchWinner: winner,
            unlocked,
            stars,
            matchStars: earned,
            bestRally,
            quote: null,
          });
        } else {
          if (p1Win) audio.matchWin();
          else audio.gameOver();
          set({ phase: "matchover", matchWinner: winner, bestRally, quote: null });
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

      // ---------- online ----------
      setOnline(patch) {
        set((s) => ({ online: { ...s.online, ...patch } }));
      },

      setPlayerName(name) {
        const clean = String(name).replace(/[^\w .-]/g, "").slice(0, 16);
        try {
          localStorage.setItem(NAME_KEY, clean);
        } catch {
          /* ignore */
        }
        get().api.setOnline({ name: clean });
      },

      openOnline() {
        resetNet();
        set((s) => ({
          phase: "online",
          mode: "online",
          online: { ...s.online, role: null, status: "idle", code: "", error: "", rematch: { me: false, them: false } },
        }));
      },

      /** Wire a connected transport into a session and start the match. */
      _beginOnline(role, transport) {
        const { api, online } = get();
        net.role = role;
        net.transport = transport;
        api.setOnline({ role });
        const name = online.name || (role === "host" ? "Host" : "Guest");
        if (role === "host") net.match = createMatch({ winScore: 7 });
        const session =
          role === "host"
            ? createHost({ transport, match: net.match, name })
            : createGuest({ transport, name });
        net.session = session;
        session.on((type, data) => {
          const st = get();
          if (st.mode !== "online") return;
          if (type === "joined") {
            audio.start();
            api.setOnline({ status: "connected", peerName: data, rematch: { me: false, them: false } });
            set((s) => ({
              phase: "playing",
              match: { p1: 0, p2: 0, server: 1 },
              matchWinner: 0,
              rally: 0,
              bestRally: 0,
              quote: null,
              banner: null,
              matchKey: s.matchKey + 1,
            }));
            showBanner(`vs ${data}`, role === "host" ? "You serve first" : "They serve first");
          } else if (type === "rematch") {
            api.setOnline({ rematch: { ...data } });
            if (role === "host" && data.me && data.them) api._onlineRestart();
          } else if (type === "restart") {
            set((s) => ({
              phase: "playing",
              match: { p1: 0, p2: 0, server: 1 },
              matchWinner: 0,
              rally: 0,
              bestRally: 0,
              banner: null,
              matchKey: s.matchKey + 1,
            }));
            api.setOnline({ rematch: { me: false, them: false } });
          } else if (type === "pause") {
            set({ phase: data ? "paused" : "playing" });
          } else if (type === "error") {
            api.setOnline({ status: "error", error: data });
            set({ phase: "online" });
          } else if (type === "closed") {
            if (get().phase === "online") return;
            api.setOnline({ status: "lost" });
            set({ phase: "matchover", banner: null });
          }
        });
        if (role === "host") api.setOnline({ status: "waiting" });
      },

      _onlineRestart() {
        const fresh = createMatch({ winScore: 7 });
        net.session.restart(fresh);
        net.match = fresh;
        set((s) => ({
          phase: "playing",
          match: { p1: 0, p2: 0, server: 1 },
          matchWinner: 0,
          rally: 0,
          bestRally: 0,
          banner: null,
          matchKey: s.matchKey + 1,
        }));
        get().api.setOnline({ rematch: { me: false, them: false } });
      },

      async hostRoom() {
        const { api } = get();
        const code = makeRoomCode();
        api.setOnline({ status: "creating", code, error: "", note: "", role: "host" });
        try {
          const transport = await createPeerHost(code, {
            onWaiting: () => api.setOnline({ status: "waiting", note: "" }),
            onStatus: (note) => api.setOnline({ note }),
          });
          if (get().phase !== "online" || get().online.code !== code) {
            transport.close("cancelled");
            return;
          }
          api._beginOnline("host", transport);
        } catch (e) {
          api.setOnline({ status: "error", error: e.message || String(e), note: "", role: null });
        }
      },

      async joinRoom(code) {
        const { api } = get();
        const clean = String(code).trim().toUpperCase();
        if (clean.length < 4) {
          api.setOnline({ status: "error", error: "Enter the 6-letter room code." });
          return;
        }
        api.setOnline({ status: "joining", code: clean, error: "", note: "", role: "guest" });
        try {
          const transport = await createPeerGuest(clean, {
            onStatus: (note) => api.setOnline({ note }),
          });
          if (get().phase !== "online") {
            transport.close("cancelled");
            return;
          }
          api._beginOnline("guest", transport);
        } catch (e) {
          api.setOnline({ status: "error", error: e.message || String(e), note: "", role: null });
        }
      },

      /** Re-run whichever attempt just failed. */
      retryOnline() {
        const { online, api } = get();
        if (online.role === "guest" || (!online.role && online.code)) api.joinRoom(online.code);
        else api.hostRoom();
      },

      onlineRematch() {
        net.session?.requestRematch();
      },

      leaveOnline() {
        resetNet();
        set((s) => ({
          phase: "menu",
          online: { ...s.online, role: null, status: "idle", code: "", error: "", rematch: { me: false, them: false } },
          banner: null,
        }));
      },

      // ---------- shared ----------
      togglePause() {
        const { phase, mode, online } = get();
        if (mode === "online" && online.role === "guest") return;
        if (phase === "playing") set({ phase: "paused" });
        else if (phase === "paused") set({ phase: "playing" });
        else return;
        if (mode === "online") net.session?.setPaused(get().phase === "paused");
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
