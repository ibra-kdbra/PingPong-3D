import { MAX_LEVEL } from "../game/levels.js";
import { useEffect, useState } from "react";
import { STAGES } from "../game/stages.js";
import { useStore, useLevel } from "../game/store.js";
import { PauseIcon, PlayIcon, SoundIcon, MutedIcon, StepInIcon, StepBackIcon } from "./icons.jsx";
import { touchHeld, releaseTouch, prefersTouch } from "../game/touchControls.js";

function Lives() {
  const lives = useStore((state) => state.lives);
  return (
    <div className="hud-lives" role="img" aria-label={`${lives} lives left`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={i < lives ? "pip" : "pip pip-lost"} />
      ))}
    </div>
  );
}

function LevelProgress() {
  const levelIndex = useStore((state) => state.level);
  const hitsInLevel = useStore((state) => state.hitsInLevel);
  const level = useLevel();
  const endless = level.hits === Infinity;
  const progress = endless ? 1 : Math.min(hitsInLevel / level.hits, 1);
  return (
    <div className="hud-level">
      <div className="hud-level-name">
        Level {levelIndex + 1}
        {levelIndex === MAX_LEVEL ? " — endless" : ""} · {level.name}
      </div>
      <div className="hud-progress">
        <div
          className="hud-progress-fill"
          style={{ width: `${progress * 100}%`, background: level.accent }}
        />
      </div>
    </div>
  );
}

function Combo() {
  const combo = useStore((state) => state.combo);
  if (combo < 3) return null;
  return (
    <div className="hud-combo" key={combo}>
      combo ×{combo}
    </div>
  );
}

function KeepUpHUD() {
  const score = useStore((state) => state.score);
  const best = useStore((state) => state.best);
  return (
    <>
      <div className="hud-score">
        <div className="hud-score-value">{score}</div>
        <div className="hud-score-best">Best {best}</div>
      </div>
      <LevelProgress />
      <Lives />
      <Combo />
    </>
  );
}

function RallyCounter() {
  const rally = useStore((state) => state.rally);
  if (rally < 5) return null;
  return (
    <div className="hud-rally" key={rally}>
      Rally {rally}
    </div>
  );
}

function OpponentQuote() {
  const quote = useStore((state) => state.quote);
  if (!quote) return null;
  return (
    <div className="hud-quote" key={quote.id}>
      {quote.text}
    </div>
  );
}

function MatchHUD() {
  const mode = useStore((state) => state.mode);
  const stageIndex = useStore((state) => state.stage);
  const match = useStore((state) => state.match);
  const online = useStore((state) => state.online);
  const stage = mode === "adventure" ? STAGES[stageIndex] : null;
  const guest = mode === "online" && online.role === "guest";
  const them = online.peerName || "Them";
  const p1Name = mode === "versus" ? "P1" : mode === "online" ? (guest ? them : "You") : "You";
  const p2Name = mode === "versus" ? "P2" : mode === "online" ? (guest ? "You" : them) : stage.opponent;

  return (
    <div className="hud-match">
      {stage && (
        <div className="hud-stage">
          {stage.name}
          {stage.modifier && <span className="tag">{stage.modifier}</span>}
        </div>
      )}
      {mode === "online" && (
        <div className="hud-stage">
          {online.latency > 0 ? `${Math.round(online.latency * 1000)} ms` : "connected"}
        </div>
      )}
      <div className="hud-board">
        <span
          className={match.server === 1 ? "hud-name serving" : "hud-name"}
        >
          {p1Name}
        </span>
        <span className="hud-points">
          {match.p1}
          <span className="hud-sep">:</span>
          {match.p2}
        </span>
        <span
          className={match.server === 2 ? "hud-name serving" : "hud-name"}
        >
          {p2Name}
        </span>
      </div>
      <OpponentQuote />
      <RallyCounter />
    </div>
  );
}


/**
 * Control legend: shown for the first seconds of a match, then hidden;
 * H brings it back. Keeps the HUD quiet during play.
 */
function Legend({ mode, touch }) {
  const matchKey = useStore((state) => state.matchKey);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 7000);
    const onKey = (e) => {
      if (e.key.toLowerCase() === "h") setVisible((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [matchKey]);
  if (!visible) return null;
  // On a touchscreen only list what a finger can do: there is no right
  // button, no Space and no H/P/M keys to press.
  const p1 = touch ? (
    <div className="legend-row">
      <span className="legend-tag">{mode === "versus" ? "P1" : "You"}</span>
      <span>drag to move</span>
      <span>higher to lob</span>
      <span>swipe fast to smash</span>
      <span>hold the arrows to step</span>
      <span>hold Loop or Chop through the hit</span>
    </div>
  ) : (
    <div className="legend-row">
      <span className="legend-tag">{mode === "versus" ? "P1" : "You"}</span>
      <span>mouse moves</span>
      <span>fast swing smashes</span>
      <span>click + swing curves</span>
      <span>right-click loop</span>
      <span><kbd>Space</kbd> chop</span>
      {mode === "versus" ? (
        <span>scroll to step</span>
      ) : (
        <span><kbd>W</kbd><kbd>S</kbd> step</span>
      )}
    </div>
  );
  return (
    <div className="legend" aria-label="Controls">
      {p1}
      {mode === "versus" && (
        <div className="legend-row">
          <span className="legend-tag">P2</span>
          <span><kbd>A</kbd><kbd>D</kbd> move</span>
          <span><kbd>W</kbd><kbd>S</kbd> aim</span>
          <span><kbd>Shift</kbd> curve</span>
          <span><kbd>E</kbd> loop</span>
          <span><kbd>Q</kbd> chop</span>
          <span><kbd>R</kbd><kbd>F</kbd> step</span>
        </div>
      )}
      {!touch && (
        <div className="legend-row legend-quiet">
          <span><kbd>H</kbd> hide</span>
          <span><kbd>P</kbd> pause</span>
          <span><kbd>M</kbd> mute</span>
        </div>
      )}
    </div>
  );
}

/** True on a touch-first device, or from the first real touch onward. */
function useTouch() {
  const [touch, setTouch] = useState(prefersTouch);
  useEffect(() => {
    if (touch) return;
    const onPointer = (e) => {
      if (e.pointerType === "touch") setTouch(true);
    };
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [touch]);
  return touch;
}

/**
 * A button held with the thumb that isn't steering — a step, or the stroke
 * to play on the next hit. It sets one field of touchHeld for exactly as
 * long as the finger is down.
 *
 * Every touch here is kept to itself. The match listens for pointer
 * presses on the whole window and reads any touch as the left mouse
 * button — which means "curve" — so without this a thumb resting on a
 * button would put curve on every stroke, and lifting it would cancel a
 * curve the other finger was still holding.
 */
function HoldButton({ field, label, className = "", children }) {
  const [held, setHeld] = useState(false);
  const set = (v) => {
    touchHeld[field] = v;
    setHeld(v);
  };
  const keep = (e) => e.stopPropagation();
  return (
    <button
      type="button"
      className={`touch-btn ${className}${held ? " touch-held" : ""}`}
      aria-label={label}
      aria-pressed={held}
      onPointerDown={(e) => {
        keep(e);
        e.preventDefault();
        // Keep receiving this finger even if it slides off the button,
        // so lifting it anywhere lets go.
        e.currentTarget.setPointerCapture?.(e.pointerId);
        set(true);
      }}
      onPointerMove={keep}
      onPointerUp={(e) => { keep(e); set(false); }}
      onPointerCancel={(e) => { keep(e); set(false); }}
      onLostPointerCapture={() => set(false)}
      onContextMenu={(e) => { keep(e); e.preventDefault(); }}
    >
      {children}
    </button>
  );
}

/**
 * Touch controls, down the left edge for the free thumb: stepping on top,
 * then the two strokes a mouse plays with the right button and Space.
 * Stepping happens between shots and the stroke at the hit, so one thumb
 * covers both. Loop and chop are decided the instant the paddle meets the
 * ball, so they are held through the hit rather than tapped.
 */
function TouchControls() {
  // Let go of everything if the page loses focus mid-hold (a call, a
  // notification, switching apps): no pointerup ever arrives for it.
  useEffect(() => {
    const drop = () => releaseTouch();
    window.addEventListener("blur", drop);
    document.addEventListener("visibilitychange", drop);
    return () => {
      releaseTouch();
      window.removeEventListener("blur", drop);
      document.removeEventListener("visibilitychange", drop);
    };
  }, []);
  return (
    <div className="touch-controls">
      <div className="touch-group" role="group" aria-label="Step in or back">
        <HoldButton field="fwd" label="Step in toward the net">
          <StepInIcon />
        </HoldButton>
        <HoldButton field="back" label="Step back from the table">
          <StepBackIcon />
        </HoldButton>
      </div>
      <div className="touch-group" role="group" aria-label="Stroke for the next hit">
        <HoldButton field="loop" label="Loop: hold through the hit" className="touch-tech">
          Loop
        </HoldButton>
        <HoldButton field="chop" label="Chop: hold through the hit" className="touch-tech">
          Chop
        </HoldButton>
      </div>
    </div>
  );
}

function Banner() {
  const banner = useStore((state) => state.banner);
  if (!banner) return null;
  return (
    <div className="banner" key={banner.id}>
      <div className="banner-title">{banner.title}</div>
      {banner.sub && <div className="banner-sub">{banner.sub}</div>}
    </div>
  );
}

export default function HUD() {
  const phase = useStore((state) => state.phase);
  const mode = useStore((state) => state.mode);
  const muted = useStore((state) => state.muted);
  const { togglePause, toggleMute } = useStore((state) => state.api);

  const inGame = phase === "playing" || phase === "paused";
  const touch = useTouch();

  return (
    <>
      {inGame && (mode === "keepup" ? <KeepUpHUD /> : <MatchHUD />)}
      {phase === "playing" && mode !== "keepup" && <Legend mode={mode} touch={touch} />}
      {touch && phase === "playing" && mode !== "keepup" && <TouchControls />}
      {inGame && (
        <div className="hud-buttons">
          <button
            className="icon-btn"
            onClick={togglePause}
            aria-label={phase === "paused" ? "Resume" : "Pause"}
            title="Pause (P / Esc)"
          >
            {phase === "paused" ? <PlayIcon /> : <PauseIcon />}
          </button>
          <button
            className="icon-btn"
            onClick={toggleMute}
            aria-label={muted ? "Unmute" : "Mute"}
            title="Mute (M)"
          >
            {muted ? <MutedIcon /> : <SoundIcon />}
          </button>
        </div>
      )}
      <Banner />
    </>
  );
}
