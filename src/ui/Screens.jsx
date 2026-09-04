import { LEVELS } from "../game/levels.js";
import { STAGES } from "../game/stages.js";
import { useStore } from "../game/store.js";
import { useState } from "react";
import { LockIcon, CheckIcon, BackIcon, StarIcon } from "./icons.jsx";
import Logo from "./Logo.jsx";

const MAX_STARS = STAGES.length * 3;

function Stars({ count, size = "" }) {
  return (
    <span className={`stars ${size}`} aria-label={`${count} of 3 stars`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={i < count ? "star on" : "star"}>
          <StarIcon />
        </span>
      ))}
    </span>
  );
}

function MenuScreen() {
  const best = useStore((state) => state.best);
  const unlocked = useStore((state) => state.unlocked);
  const stars = useStore((state) => state.stars);
  const { startKeepUp, toMap, startVersus, openOnline } = useStore((state) => state.api);
  const beatenAll = unlocked >= STAGES.length;
  const totalStars = Object.values(stars).reduce((a, b) => a + b, 0);
  return (
    <div className="screen">
      <div className="panel panel-menu">
        <h1 className="title">
          <Logo size={44} />
          PingPong <span className="title-3d">3D</span>
        </h1>
        <p className="tagline">Table tennis with real physics</p>

        <div className="mode-list">
          <button className="btn btn-primary" onClick={toMap}>
            <span className="mode-name">Adventure</span>
            <span className="mode-desc">
              {beatenAll
                ? `Complete · ${totalStars}/${MAX_STARS} stars`
                : totalStars > 0
                  ? `Stage ${Math.min(unlocked, STAGES.length - 1) + 1} of ${STAGES.length} · ${totalStars}/${MAX_STARS} stars`
                  : `${STAGES.length} opponents, ${STAGES.length} arenas`}
            </span>
          </button>
          <button className="btn btn-mode" onClick={openOnline}>
            <span className="mode-name">Play online</span>
            <span className="mode-desc">A friend, a room code</span>
          </button>
          <button className="btn btn-mode" onClick={startVersus}>
            <span className="mode-name">Two players</span>
            <span className="mode-desc">Mouse vs keyboard</span>
          </button>
          <button className="btn btn-mode" onClick={startKeepUp}>
            <span className="mode-name">Keep-up</span>
            <span className="mode-desc">
              {best > 0 ? `Solo survival · best ${best}` : "Solo survival"}
            </span>
          </button>
        </div>

        <p className="howto">
          Move with the mouse. Swing fast to smash, hold click while swinging
          to curve.
        </p>
      </div>
    </div>
  );
}

function MapScreen() {
  const unlocked = useStore((state) => state.unlocked);
  const stars = useStore((state) => state.stars);
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
                      {stage.modifier && !locked && (
                        <span className="tag">{stage.modifier}</span>
                      )}
                    </span>
                    <span className="stage-tag">
                      {locked ? "Beat the previous stage to unlock" : stage.tagline}
                    </span>
                  </span>
                  <span className="stage-status">
                    {locked ? (
                      <LockIcon />
                    ) : beaten ? (
                      <Stars count={stars[i] || 0} />
                    ) : (
                      `to ${stage.winScore}`
                    )}
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


function OnlineScreen() {
  const online = useStore((state) => state.online);
  const { hostRoom, joinRoom, leaveOnline, setPlayerName } = useStore((state) => state.api);
  const [code, setCode] = useState("");
  const busy = online.status === "creating" || online.status === "joining" || online.status === "waiting";

  return (
    <div className="screen">
      <div className="panel panel-online">
        <div className="map-head">
          <button className="icon-btn" onClick={leaveOnline} aria-label="Back to menu">
            <BackIcon />
          </button>
          <h2 className="subtitle">Play online</h2>
        </div>

        <label className="field">
          <span className="field-label">Your name</span>
          <input
            className="input"
            maxLength={16}
            value={online.name}
            placeholder="Player"
            onChange={(e) => setPlayerName(e.target.value)}
            disabled={busy}
          />
        </label>

        {online.status === "waiting" || online.status === "creating" ? (
          <div className="room">
            <span className="field-label">Room code — send it to your friend</span>
            <div className="room-code" aria-live="polite">{online.code || "······"}</div>
            <p className="matchover-sub">
              {online.status === "creating" ? "Opening the room…" : "Waiting for them to join…"}
            </p>
            <button className="btn btn-ghost" onClick={leaveOnline}>Cancel</button>
          </div>
        ) : (
          <>
            <button className="btn btn-primary" onClick={hostRoom} disabled={busy}>
              Create a room
            </button>
            <div className="divider">or join one</div>
            <form
              className="join"
              onSubmit={(e) => {
                e.preventDefault();
                joinRoom(code);
              }}
            >
              <input
                className="input input-code"
                maxLength={6}
                value={code}
                placeholder="ROOM CODE"
                autoCapitalize="characters"
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                disabled={busy}
              />
              <button className="btn btn-mode" type="submit" disabled={busy || code.length < 4}>
                {online.status === "joining" ? "Connecting…" : "Join"}
              </button>
            </form>
          </>
        )}

        {online.status === "error" && <p className="error">{online.error}</p>}
        <p className="howto howto-quiet">
          <span>Peer-to-peer over WebRTC · first to 7 · the host serves first</span>
        </p>
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

function OnlineOverScreen() {
  const online = useStore((state) => state.online);
  const match = useStore((state) => state.match);
  const winner = useStore((state) => state.matchWinner);
  const bestRally = useStore((state) => state.bestRally);
  const { onlineRematch, leaveOnline } = useStore((state) => state.api);
  const me = online.role === "guest" ? 2 : 1;
  const mine = me === 1 ? match.p1 : match.p2;
  const theirs = me === 1 ? match.p2 : match.p1;
  const lost = online.status === "lost";
  const won = winner === me;
  const them = online.peerName || "Your friend";
  return (
    <div className="screen screen-dim">
      <div className="panel">
        <h2 className="subtitle">{lost ? "Connection lost" : won ? "Victory" : "Defeat"}</h2>
        <p className="matchover-sub">
          {lost ? `${them} disconnected.` : won ? `${them} is beaten.` : `${them} takes it.`}
        </p>
        <div className="final-score">
          {mine}
          <span className="final-sep">:</span>
          {theirs}
        </div>
        {bestRally >= 6 && <p className="matchover-sub">Longest rally: {bestRally} shots</p>}
        {!lost && (
          <button
            className={online.rematch.me ? "btn btn-mode" : "btn btn-primary"}
            onClick={onlineRematch}
            disabled={online.rematch.me}
          >
            {online.rematch.me
              ? "Waiting for " + them + "…"
              : online.rematch.them
                ? `${them} wants a rematch — go`
                : "Rematch"}
          </button>
        )}
        <button className="btn btn-ghost" onClick={leaveOnline}>
          Leave
        </button>
      </div>
    </div>
  );
}

function MatchOverScreen() {
  const mode = useStore((state) => state.mode);
  if (mode === "online") return <OnlineOverScreen />;
  return <LocalOverScreen />;
}

function LocalOverScreen() {
  const mode = useStore((state) => state.mode);
  const stageIndex = useStore((state) => state.stage);
  const match = useStore((state) => state.match);
  const winner = useStore((state) => state.matchWinner);
  const matchStars = useStore((state) => state.matchStars);
  const bestRally = useStore((state) => state.bestRally);
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
        {stage && won && <Stars count={matchStars} size="stars-lg" />}
        {stage && won && matchStars < 3 && (
          <p className="matchover-hint">
            {matchStars === 1
              ? `Hold ${stage.opponent} under ${Math.ceil(stage.winScore / 2)} for two stars`
              : "A shutout earns three stars"}
          </p>
        )}
        {bestRally >= 6 && (
          <p className="matchover-sub">Longest rally: {bestRally} shots</p>
        )}
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
        {mode === "adventure" && won && matchStars < 3 && (
          <button className="btn btn-ghost" onClick={retryMatch}>
            Replay for stars
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
  if (phase === "online") return <OnlineScreen />;
  if (phase === "paused") return <PauseScreen />;
  if (phase === "gameover") return <KeepUpGameOver />;
  if (phase === "matchover") return <MatchOverScreen />;
  return null;
}
