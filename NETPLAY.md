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
- **Disconnect / close**: a clean DataChannel close ends the match with a
  "connection lost" screen. A peer that simply vanishes — closed laptop,
  killed tab, dead network — never sends one, and WebRTC itself can take
  30 s or more to notice, so both sides also watch for silence: traffic
  runs constantly (snapshots one way, inputs the other, pings every 2 s),
  and five seconds without a single message ends the match. No hanging
  states either way.
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

Roughly one connection in five needs case 3. That is not an edge case,
so the relay is treated as part of the product rather than a fallback.

### Where a relay comes from

`src/net/ice.js` assembles the ICE list from four sources, best first:

| Order | Source | Set by |
| --- | --- | --- |
| 1 | The player's own relay | **Relay server** in the lobby, or `?turn=…&turnuser=…&turnpass=…` in the shared link |
| 2 | A credentials endpoint | **Credentials URL** in the lobby, `?ice=…` in the link, or `VITE_ICE_ENDPOINT` |
| 3 | A relay compiled into the build | `VITE_TURN_URLS` / `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL` |
| 4 | Public relays | Built in, best-effort |

A credentials endpoint is the best option for a deployment: it is a URL
that mints short-lived credentials on request, so nothing secret is
baked into the bundle. Both the metered.ca response shape (a bare array)
and the Cloudflare one (`{ iceServers: {...} }`) are understood. If the
provider is slow or down the game degrades to the next source rather
than failing to connect.

### Giving the published game a relay

The Pages workflow passes four optional repository secrets into the
build (`ICE_ENDPOINT`, `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL`).
Set `ICE_ENDPOINT` to a provider URL — a free metered.ca or Cloudflare
account takes a couple of minutes — and every player gets a working
relay without configuring anything. Leave them unset and the game still
builds; it just falls back to the public relays.

### Why the public relays cannot be relied on

They are free, shared and rate-limited, and they come and go: the TURN
hosts PeerJS used to ship (`eu-0.turn.peerjs.com`, `us-0.turn.peerjs.com`)
no longer resolve at all. A hostname that fails to resolve is not merely
useless — the browser waits on it during every gathering pass — so the
list is kept to hosts that answer, with `turns:` on 443 first because TLS
on the HTTPS port is what survives locked-down networks.

### Knowing before you play

**Test relay** in the lobby runs a real ICE gathering pass with
`iceTransportPolicy: "relay"`, so a candidate can only come from TURN.
One arriving proves the relay works end to end, on that player's own
network and firewall. It reports the round-trip time on success, and on
failure distinguishes "the relay rejected these credentials" (a 401
during gathering) from "nothing answered". That turns a 30-second failed
join into a two-second answer.

## Security posture

The host can cheat (it runs the engine). For a casual friend-to-friend
game this is acceptable and stated. Everything the guest receives is
treated as data (no code, no HTML). Room codes are unguessable enough
for a game; no personal data is exchanged beyond a display name.

## Testing

`src/net/session.js` (host/guest logic, serialisation, smoothing) is
pure JS with a pluggable transport and an injectable clock. `createLoopbackPair()` connects a
host and a guest in one process with an optional simulated latency and
loss, so the whole online flow — handshake, inputs, snapshots, events,
rematch, disconnect, heartbeat timeout — runs under `node --test` with
no network.

The real client is covered too: point the game at a local signalling
server with `configureSignalling({ host, port, path, secure })`, run
`peerjs-server`, and drive two browser pages against it. That exercises
the actual PeerJS client, RTCPeerConnection and DataChannel end to end —
create a room, join by code, play a full match, rematch, disconnect —
without touching the public server.

A sixty-second two-session soak is the test that catches what unit tests
cannot: score and phase agreement sampled once a second, ball divergence
between the host's engine and the guest's shadow, latency drift, heap
growth and frame times. It is also how the ordering bug below was
confirmed fixed — the harness hooks `RTCPeerConnection.createDataChannel`
and asserts the channel really is created ordered.

## Two failures worth remembering

**The channel was unordered.** PeerJS creates the data channel as
`{ ordered: !!options.reliable }`, and `reliable` is not passed by
default. Snapshots carry the score and the phase, so a snapshot
overtaking a newer one visibly rewound the game. The channel now asks
for `reliable: true`, *and* every snapshot is numbered so the guest can
drop stale ones — a protocol that only works because the transport is
polite is a protocol waiting to break.

**A closed tab took five seconds to notice.** Nothing sent a goodbye, so
the peer waited out the full heartbeat timeout. Closing the connection
on `pagehide` cut that to about 130 ms, measured.
