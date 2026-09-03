import { MAX_LEVEL } from "../game/levels.js";
import { STAGES } from "../game/stages.js";
import { useStore, useLevel } from "../game/store.js";
import { PauseIcon, PlayIcon, SoundIcon, MutedIcon } from "./icons.jsx";

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
      {mode === "online" && (
        <div className="hud-controls-hint">
          {online.latency > 0 ? `${Math.round(online.latency * 1000)} ms` : "connected"} · click+swing curve · right-click loop · Space chop
        </div>
      )}
      {mode === "versus" && (
        <div className="hud-controls-hint">P1 mouse · click+swing curve · right-click loop · Space chop &nbsp;|&nbsp; P2 A/D · W/S aim · Shift curve · E loop · Q chop</div>
      )}
      <OpponentQuote />
      <RallyCounter />
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

  return (
    <>
      {inGame && (mode === "keepup" ? <KeepUpHUD /> : <MatchHUD />)}
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
