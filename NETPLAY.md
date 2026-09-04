# Online play — design

Goal: two people on different machines play a full match with the same
rules, physics and feel as local play, from a **statically hosted** game
(GitHub Pages) with no game server to run.

## Architecture: host-authoritative over WebRTC

```
  Player A (host)                          Player B (guest)
  ┌──────────────────────┐   inputs 60 Hz   ┌──────────────────────┐
  │ match engine (truth) │◄────────────────│ local input sampling  │
  │ step at fixed 120 Hz │   snapshots 30Hz │ shadow ball integrator│
  │ renders own view     │────────────────►│ renders mirrored view │
  └──────────────────────┘   + events       └──────────────────────┘
            ▲  signalling (once, to exchange SDP)  ▲
            └───────── PeerJS cloud ───────────────┘
```

- **One engine instance** — the host's — is the single source of truth.
  The guest never simulates rules; it only sends inputs and draws what
  the host says happened. No divergence, no reconciliation of rules.
- **Transport**: a WebRTC DataChannel (unreliable-ish, low latency) set
  up via [PeerJS](https://peerjs.com). PeerJS' free public signalling
  server brokers the connection; after that traffic is peer-to-peer.
  A room code *is* the host's peer id. Self-hosting a PeerServer is one
  command if the public one ever becomes unreliable.
- **Why not lockstep?** Deterministic lockstep needs identical floating
  point on both machines and stalls on any lost packet. Host-authority
  tolerates jitter and loss; table tennis has one ball and two paddles,
  so a snapshot is ~20 numbers — bandwidth is a non-issue.

## Protocol (JSON over the DataChannel)

| msg | from | rate | payload |
| --- | --- | --- | --- |
| `hello` | guest | once | `{ name, version }` |
| `welcome` | host | once | `{ name, version, winScore }` — version mismatch aborts |
| `input` | guest | every frame | `{ seq, x, vx, aim, spin, tech }` (guest's paddle) |
| `snap` | host | 30 Hz | `{ t, ball:[x,y,z,vx,vy,vz,sx,ts], p:[x1,vx1,x2,vx2], phase, srv, sc:[a,b], rally }` |
| `ev` | host | on event | `{ list:[[type,a,b,c]…] }` — hits, bounces, points, net cords, over |
| `ctl` | both | on demand | `{ op:'rematch'|'leave'|'ping'|'pong', t }` |

The guest's paddle is applied on the host from the latest `input`; the
guest also renders its own paddle from local input immediately (client
prediction for the one thing latency would make feel bad).

## Time and smoothing

- The engine steps at a **fixed 120 Hz** with an accumulator on the host
  (also used offline now — same feel everywhere, deterministic tests).
- The guest keeps a **shadow ball**: it integrates gravity/velocity/spin
  locally every frame from the last snapshot, and eases toward each new
  snapshot over ~80 ms. At 30 Hz snapshots a 60–120 ms link gives a
  ball that moves smoothly and lands where the host says.
- Events are authoritative and drive audio, banners and score — never
  inferred from snapshots, so both players hear the same point.

## Perspective

Each player sees the table from *their* end. The guest's scene group is
rotated 180° and its pointer x is mirrored before sending, so "move
right" is right on both screens. HUD labels are "You / Them" on both
sides; scores are shown from each player's own perspective.

## Lifecycle and failure

- **Create room** → host gets a 6-char code (readable alphabet, no 0/O/1/I),
  shows it, waits. **Join** → guest enters code → `hello`/`welcome` →
  both go to the match; the host serves first.
- **Rematch**: either side sends `rematch`; the host restarts its engine
  when both have agreed (a two-way handshake, like a rematch button that
  lights up when the other side pressed it).
- **Disconnect / close**: the DataChannel close event ends the match
  with a "connection lost" screen; no hanging states. Pings every 2 s
  keep the HUD's latency badge honest.
- **Pause** is host-only and mirrored to the guest as a phase in `snap`.

## Getting a connection (ICE)

WebRTC only carries data once ICE finds a network path between the two
browsers. Three outcomes, in order of preference:

1. **Direct, same network** — host candidates, always works.
2. **Direct across the internet** — STUN discovers each side's public
   address and they punch through their NATs. Works for most home
   connections.
3. **Relayed** — when NAT is symmetric (common on mobile data and
   corporate Wi-Fi) or UDP is blocked, traffic must go through a TURN
   relay. Without a working relay ICE fails, which PeerJS reports as
   *"Negotiation of connection to … failed"*.

PeerJS ships one STUN server plus its own free TURN relays, which are
heavily rate-limited. We therefore configure several STUN servers and
more than one TURN relay, including TLS on port 443 for networks that
only allow HTTPS (`ICE_SERVERS` in `src/net/transport.js`).

Free relays are still best-effort. For a guaranteed connection, run your
own `coturn` and put its URL and credentials in `ICE_SERVERS`; the same
applies to the signalling server, where a self-hosted `peerjs-server`
replaces the public one via `PEER_OPTIONS`.

## Security posture

The host can cheat (it runs the engine). For a casual friend-to-friend
game this is acceptable and stated. Everything the guest receives is
treated as data (no code, no HTML). Room codes are unguessable enough
for a game; no personal data is exchanged beyond a display name.

## Testing

`src/net/session.js` (host/guest logic, serialisation, smoothing) is
pure JS with a pluggable transport. `createLoopbackPair()` connects a
host and a guest in one process with an optional simulated latency and
loss, so the whole online flow — handshake, inputs, snapshots, events,
rematch, disconnect — runs under `node --test` with no network.
