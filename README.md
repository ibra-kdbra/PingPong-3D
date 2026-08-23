# PingPong 3D

A fast, physics-driven 3D table-tennis game built with **React Three Fiber**.
Three ways to play: an eight-stage **Adventure** against AI opponents, local
**two-player** on one screen, and the original **Keep-up** survival mode.

## Game modes

### Adventure
Work through eight opponents of rising skill — from Botan, a cheerful rookie
who telegraphs every shot, to Unit 09, a machine that almost never misses.
Each stage has its own arena theme, win target, and AI personality (paddle
speed, reaction delay, accuracy, aggression). Progress is saved locally, and
beaten stages stay unlocked.

### Two players
Same screen, same table. Player 1 steers with the mouse (height aims the
shot: high lobs, low drives). Player 2 moves with `A`/`D` and aims with
`W`/`S`. First to 7.

### Keep-up
The solo survival mode: keep the ball on your paddle through 8 levels of
rising gravity, wind, and shrinking balls. Combo multipliers, 3 lives,
persistent best score.

## The match engine

Matches run on a custom, dependency-free table-tennis engine
(`src/game/match.js`) written for speed and testability:

- **Real rules, arcade pacing** — serves alternate every two points; shots
  must clear the net and land on the opponent's half; double bounces,
  nets, and outs are all called with the right point going the right way.
- **Ballistic shot solver** — every stroke solves a real parabolic flight
  to a target point, so net clips and long balls emerge from physics, not
  scripts. Swing speed steers placement; mouse height picks lob vs drive.
- **Rally pressure** — shot error grows as a rally drags on, so points
  always resolve and long rallies get tense.
- **Zero allocations in the hot path** — the engine mutates one state
  object and reuses event buffers; React renders only on point changes.
- **Unit-tested in Node** — `npm test` simulates thousands of engine steps:
  serve legality, fault attribution, service rotation, match completion,
  and long AI-vs-bot matches run headless with a seeded RNG.

## Performance

- Adaptive quality: a performance monitor watches the real frame rate and
  permanently degrades cost (shadows, particles, resolution cap) the
  moment a device can't hold the target — no oscillating quality.
- Device pixel ratio capped at 1.75, `high-performance` GPU preference.
- All per-frame game state lives in refs and mutated objects; the React
  tree re-renders only on scores, phases, and banners.

## Controls

| Input | Action |
| --- | --- |
| Mouse / touch | Move paddle · mouse height aims lob/drive (match modes) |
| `A` `D` / `W` `S` | Player 2 move / aim (two-player mode) |
| `P` or `Esc` | Pause / resume |
| `M` | Mute / unmute |

## Setup

Download [Node.js](https://nodejs.org/en/download/), then:

```bash
npm install     # first time only
npm run dev     # local dev server
npm test        # match-engine unit tests
npm run build   # production build (outputs to docs/)
npm run preview # preview the production build
```

## Project structure

```
src/
├── game/
│   ├── match.js      # table-tennis engine: physics, rules, AI (pure JS)
│   ├── stages.js     # adventure opponents, difficulty + arena themes
│   ├── store.js      # zustand state machine for all modes
│   ├── levels.js     # keep-up level definitions
│   ├── collision.js  # cannon collision filter groups (keep-up)
│   └── audio.js      # pooled hit sounds + WebAudio synth cues
├── components/
│   ├── Scene.jsx       # mode routing, environment, adaptive quality
│   ├── MatchScene.jsx  # table, net, paddles, engine loop
│   ├── Paddle.jsx      # keep-up glove paddle (cannon kinematic body)
│   ├── Ball.jsx        # keep-up ball: trail, wind, stall detection
│   ├── Arena.jsx       # keep-up bounds + themed floor
│   └── Text.jsx        # 3D score digits on the keep-up paddle
├── ui/
│   ├── HUD.jsx       # mode-aware HUD: scoreboard, lives, combo, banners
│   ├── Screens.jsx   # menu, adventure map, pause, game/match over
│   └── icons.jsx     # inline SVG icons
└── Experience.jsx    # canvas + UI shell + keyboard shortcuts
tests/
└── match.test.mjs    # engine rule suite (node --test)
```

## Roadmap

- [ ] Online multiplayer (needs a small relay server — the engine is
      deterministic and ready for lockstep)
- [ ] Spin: paddle swipes imparting curve to the flight path
- [ ] Tournament mode: best-of-3 sets, seeded brackets
- [ ] Replays of match points
- [ ] Gamepad support
