import { LEVELS } from "../game/levels.js";
import { STAGES } from "../game/stages.js";
import { useStore } from "../game/store.js";
import { LockIcon, CheckIcon, BackIcon } from "./icons.jsx";

function MenuScreen() {
  const best = useStore((state) => state.best);
  const unlocked = useStore((state) => state.unlocked);
  const { startKeepUp, toMap, startVersus } = useStore((state) => state.api);
  const beatenAll = unlocked >= STAGES.length;
  return (
    <div className="screen">
      <div className="panel panel-menu">
        <h1 className="title">
          PingPong <span className="title-3d">3D</span>
        </h1>
        <p className="tagline">Table tennis with real physics</p>

        <div className="mode-list">
          <button className="btn btn-primary" onClick={toMap}>
            <span className="mode-name">Adventure</span>
            <span className="mode-desc">
              {beatenAll
                ? "All eight opponents beaten"
                : `Beat ${STAGES.length} opponents · stage ${Math.min(unlocked, STAGES.length - 1) + 1} unlocked`}
            </span>
          </button>
          <button className="btn btn-mode" onClick={startVersus}>
            <span className="mode-name">Two players</span>
            <span className="mode-desc">Mouse vs keyboard, one screen</span>
          </button>
          <button className="btn btn-mode" onClick={startKeepUp}>
            <span className="mode-name">Keep-up</span>
            <span className="mode-desc">
              {best > 0 ? `Solo survival · best ${best}` : "Solo survival"}
            </span>
          </button>
        </div>

        <div className="howto">
          <span><kbd>P</kbd> pause</span>
          <span><kbd>M</kbd> mute</span>
          <span>Swing fast to smash</span>
        </div>
      </div>
    </div>
  );
}

function MapScreen() {
  const unlocked = useStore((state) => state.unlocked);
  const { startStage, toMenu } = useStore((state) => state.api);
  return (
    <div className="screen">
      <div className="panel panel-map">
        <div className="map-head">
          <button className="icon-btn" onClick={toMenu} aria-label="Back to menu">
            <BackIcon />
          </button>
          <h2 className="subtitle">Adventure</h2>
        </div>
        <ol className="stage-list">
          {STAGES.map((stage, i) => {
            const locked = i > unlocked;
            const beaten = i < unlocked;
            return (
              <li key={stage.name}>
                <button
                  className={locked ? "stage locked" : "stage"}
                  disabled={locked}
                  onClick={() => startStage(i)}
                  style={locked ? undefined : { "--stage-accent": stage.theme.accent }}
                >
                  <span className="stage-num">{i + 1}</span>
                  <span className="stage-info">
                    <span className="stage-name">
                      {stage.name} · vs {stage.opponent}
                    </span>
                    <span className="stage-tag">
                      {locked ? "Beat the previous stage to unlock" : stage.tagline}
                    </span>
                  </span>
                  <span className="stage-status">
                    {locked ? <LockIcon /> : beaten ? <CheckIcon /> : `to ${stage.winScore}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function PauseScreen() {
  const { togglePause, toMenu } = useStore((state) => state.api);
  return (
    <div className="screen screen-dim">
      <div className="panel">
        <h2 className="subtitle">Paused</h2>
        <button className="btn btn-primary" onClick={togglePause}>
          Resume
        </button>
        <button className="btn btn-ghost" onClick={toMenu}>
          Quit to menu
        </button>
      </div>
    </div>
  );
}

function KeepUpGameOver() {
  const score = useStore((state) => state.score);
  const best = useStore((state) => state.best);
  const newBest = useStore((state) => state.newBest);
  const maxCombo = useStore((state) => state.maxCombo);
  const totalHits = useStore((state) => state.totalHits);
  const level = useStore((state) => state.level);
  const { startKeepUp, toMenu } = useStore((state) => state.api);
  return (
    <div className="screen screen-dim">
      <div className="panel">
        <h2 className="subtitle">Game over</h2>
        {newBest && <div className="new-best">New best</div>}
        <div className="final-score">{score}</div>
        <dl className="stats">
          <div><dt>Best</dt><dd>{best}</dd></div>
          <div><dt>Level</dt><dd>{level + 1} · {LEVELS[level].name}</dd></div>
          <div><dt>Max combo</dt><dd>×{maxCombo}</dd></div>
          <div><dt>Hits</dt><dd>{totalHits}</dd></div>
        </dl>
        <button className="btn btn-primary" onClick={startKeepUp}>
          Play again
        </button>
        <button className="btn btn-ghost" onClick={toMenu}>
          Menu
        </button>
      </div>
    </div>
  );
}

function MatchOverScreen() {
  const mode = useStore((state) => state.mode);
  const stageIndex = useStore((state) => state.stage);
  const match = useStore((state) => state.match);
  const winner = useStore((state) => state.matchWinner);
  const { retryMatch, nextStage, toMap, toMenu } = useStore(
    (state) => state.api
  );
  const won = winner === 1;
  const stage = mode === "adventure" ? STAGES[stageIndex] : null;
  const lastStage = stage && stageIndex === STAGES.length - 1;

  return (
    <div className="screen screen-dim">
      <div className="panel">
        <h2 className="subtitle">
          {mode === "versus"
            ? `Player ${winner} wins`
            : won
              ? lastStage
                ? "Champion"
                : "Victory"
              : "Defeat"}
        </h2>
        {stage && (
          <p className="matchover-sub">
            {won
              ? lastStage
                ? "You beat the Machine. The table is yours."
                : `${stage.opponent} is beaten.`
              : `${stage.opponent} takes it.`}
          </p>
        )}
        <div className="final-score">
          {match.p1}
          <span className="final-sep">:</span>
          {match.p2}
        </div>
        {mode === "adventure" && won && !lastStage && (
          <button className="btn btn-primary" onClick={nextStage}>
            Next stage
          </button>
        )}
        {mode === "adventure" && !won && (
          <button className="btn btn-primary" onClick={retryMatch}>
            Rematch
          </button>
        )}
        {mode === "versus" && (
          <button className="btn btn-primary" onClick={retryMatch}>
            Rematch
          </button>
        )}
        {mode === "adventure" ? (
          <button className="btn btn-ghost" onClick={toMap}>
            Stage map
          </button>
        ) : (
          <button className="btn btn-ghost" onClick={toMenu}>
            Menu
          </button>
        )}
      </div>
    </div>
  );
}

export default function Screens() {
  const phase = useStore((state) => state.phase);
  if (phase === "menu") return <MenuScreen />;
  if (phase === "map") return <MapScreen />;
  if (phase === "paused") return <PauseScreen />;
  if (phase === "gameover") return <KeepUpGameOver />;
  if (phase === "matchover") return <MatchOverScreen />;
  return null;
}
