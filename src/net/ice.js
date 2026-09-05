/**
 * ICE configuration: STUN for discovering your public address, TURN for
 * relaying when the two networks refuse to talk directly.
 *
 * Roughly one connection in five needs a relay — symmetric NAT on mobile
 * data, corporate and campus Wi-Fi, most VPNs. Without one those players
 * simply cannot play, so the relay is not a nicety; it is the difference
 * between "works on any network" and "works on mine".
 *
 * Relays are tried in this order, best first:
 *   1. A relay the player typed in (Advanced, or ?turn= in the link).
 *   2. A credentials endpoint — a provider URL that mints short-lived
 *      credentials on demand. Nothing secret ships in the bundle.
 *   3. A relay baked in at build time from VITE_TURN_* (see DEPLOY.md),
 *      so the published game carries one without every player setting
 *      one up.
 *   4. Best-effort public relays. Free, shared, rate-limited: they often
 *      work and can never be relied on.
 */

/** Vite replaces import.meta.env at build time; undefined under plain node. */
const env = (key) => {
  try {
    return import.meta.env?.[key] || "";
  } catch {
    return "";
  }
};

/**
 * STUN only tells you your own public address, so several are listed
 * purely for redundancy — whichever answers first wins and the rest cost
 * nothing.
 */
export const STUN_SERVERS = [
  {
    urls: [
      "stun:stun.l.google.com:19302",
      "stun:stun1.l.google.com:19302",
      "stun:stun.cloudflare.com:3478",
    ],
  },
];

/**
 * Best-effort public relays.
 *
 * `turns:` on 443 comes first deliberately: it is TLS over TCP on the
 * HTTPS port, so to a firewall it is indistinguishable from web traffic
 * and it is the variant that survives locked-down networks. Plain UDP is
 * faster when it is allowed, and the browser will prefer it on its own.
 *
 * Anything that failed to resolve is not listed. Dead hostnames are not
 * harmless: the browser waits on each one during gathering, so a stale
 * entry costs seconds on every single connection.
 */
export const PUBLIC_TURN = [
  {
    urls: [
      "turns:staticauth.openrelay.metered.ca:443?transport=tcp",
      "turn:staticauth.openrelay.metered.ca:443?transport=tcp",
      "turn:staticauth.openrelay.metered.ca:80",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: [
      "turns:openrelay.metered.ca:443?transport=tcp",
      "turn:openrelay.metered.ca:443?transport=tcp",
      "turn:openrelay.metered.ca:80",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

/** Kept for callers that just want "everything we know about". */
export const ICE_SERVERS = [...STUN_SERVERS, ...PUBLIC_TURN];

const TURN_KEY = "pingpong3d.turn";
const ENDPOINT_KEY = "pingpong3d.iceEndpoint";

/**
 * A relay the player supplied themselves, or null. Returned exactly as it
 * was stored — the settings form prefills from this, so it keeps the
 * player's own text rather than a normalised rewrite of it.
 */
export function loadTurn() {
  try {
    const raw = localStorage.getItem(TURN_KEY);
    const turn = raw ? JSON.parse(raw) : null;
    return turn && turn.urls ? turn : null;
  } catch {
    return null;
  }
}

export function saveTurn(turn) {
  try {
    if (turn && turn.urls) localStorage.setItem(TURN_KEY, JSON.stringify(turn));
    else localStorage.removeItem(TURN_KEY);
  } catch {
    /* private mode */
  }
}

/** A URL that mints credentials, supplied by the player or the build. */
export function loadEndpoint() {
  try {
    return localStorage.getItem(ENDPOINT_KEY) || env("VITE_ICE_ENDPOINT");
  } catch {
    return env("VITE_ICE_ENDPOINT");
  }
}

export function saveEndpoint(url) {
  try {
    if (url) localStorage.setItem(ENDPOINT_KEY, String(url).trim());
    else localStorage.removeItem(ENDPOINT_KEY);
  } catch {
    /* private mode */
  }
}

/** One entry, with `urls` always an array and blank credentials dropped. */
function normalise(server) {
  if (!server) return null;
  const urls = Array.isArray(server.urls)
    ? server.urls.filter(Boolean)
    : String(server.urls || "")
        .split(/[\s,]+/)
        .filter(Boolean);
  if (!urls.length) return null;
  const out = { urls };
  if (server.username) out.username = String(server.username);
  if (server.credential) out.credential = String(server.credential);
  return out;
}

/** The relay compiled into this build, or null. */
export function buildTurn() {
  return normalise({
    urls: env("VITE_TURN_URLS"),
    username: env("VITE_TURN_USERNAME"),
    credential: env("VITE_TURN_CREDENTIAL"),
  });
}

/**
 * A relay can also travel in the link you send your friend:
 * ...?turn=turn:host:3478&turnuser=NAME&turnpass=SECRET
 * so both sides end up on the same relay from one shared URL.
 */
export function turnFromUrl(search) {
  const q = new URLSearchParams(search || "");
  const urls = q.get("turn");
  if (!urls) return null;
  return {
    urls,
    username: q.get("turnuser") || "",
    credential: q.get("turnpass") || "",
  };
}

/** A credentials endpoint can travel in the link too: ?ice=https://… */
export function endpointFromUrl(search) {
  const q = new URLSearchParams(search || "");
  return q.get("ice") || "";
}

/**
 * Providers disagree on the response shape, so accept all three we have
 * seen: a bare array of servers (metered), `{ iceServers: [...] }`, and
 * `{ iceServers: {...} }` for a single server (Cloudflare).
 */
export function parseIceResponse(body) {
  const raw = Array.isArray(body)
    ? body
    : Array.isArray(body?.iceServers)
      ? body.iceServers
      : body?.iceServers
        ? [body.iceServers]
        : Array.isArray(body?.v)
          ? body.v
          : [];
  return raw.map(normalise).filter(Boolean);
}

/**
 * Credentials are short-lived, so a fetched set is cached only briefly —
 * long enough that hosting and then joining does not hit the provider
 * twice, short enough that a stale credential never reaches ICE.
 */
const CACHE_TTL = 5 * 60 * 1000;
const FETCH_TIMEOUT = 6000;
let cache = { url: "", at: 0, servers: [] };

/** Ask a provider for credentials. Never throws: [] means "carry on". */
export async function fetchIceServers(url, { fetcher = globalThis.fetch, now = Date.now } = {}) {
  const endpoint = String(url || "").trim();
  if (!endpoint || !fetcher) return [];
  if (cache.url === endpoint && now() - cache.at < CACHE_TTL) return cache.servers;
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT) : 0;
  try {
    const res = await fetcher(endpoint, { signal: ctrl?.signal });
    if (!res?.ok) return [];
    const servers = parseIceResponse(await res.json());
    if (servers.length) cache = { url: endpoint, at: now(), servers };
    return servers;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Forget any cached credentials (used by the relay test and by tests). */
export function clearIceCache() {
  cache = { url: "", at: 0, servers: [] };
}

/** Everything we can offer ICE, best relay first. Never throws. */
export async function resolveIce(options = {}) {
  const own = normalise(options.turn ?? loadTurn());
  const built = buildTurn();
  const endpoint = options.endpoint ?? loadEndpoint();
  const fetched = await fetchIceServers(endpoint, options);
  const relays = [own, ...fetched, built, ...PUBLIC_TURN].filter(Boolean);
  return [...STUN_SERVERS, ...dedupe(relays)];
}

/** The synchronous list — used before an async resolve has finished. */
export function iceServersSync(turn = loadTurn()) {
  const relays = [normalise(turn), buildTurn(), ...PUBLIC_TURN].filter(Boolean);
  return [...STUN_SERVERS, ...dedupe(relays)];
}

function dedupe(servers) {
  const seen = new Set();
  const out = [];
  for (const s of servers) {
    const key = `${s.urls.join("|")}#${s.username || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** Human text for the ICE error codes a relay can return during gathering. */
export function candidateErrorText(code, text) {
  if (code === 401 || code === 403) return "the relay rejected these credentials";
  if (code === 701) return "the relay could not be reached";
  if (code >= 300 && code < 400) return "the relay redirected the connection";
  return text || `error ${code}`;
}

/**
 * Ask the browser to actually get a relayed address from these servers.
 *
 * This is the only honest test: it runs on the player's own network,
 * against their own firewall, with their own credentials. `relay`-only
 * transport policy means a candidate can *only* come from TURN, so one
 * arriving proves the relay works end to end.
 */
export function probeRelay(servers, { timeout = 8000, RTC = globalThis.RTCPeerConnection } = {}) {
  return new Promise((resolve) => {
    if (!RTC) {
      resolve({ ok: false, reason: "This browser can't test connections." });
      return;
    }
    const relayServers = servers.filter((s) =>
      s.urls.some((u) => u.startsWith("turn:") || u.startsWith("turns:"))
    );
    if (!relayServers.length) {
      resolve({ ok: false, reason: "No relay is configured." });
      return;
    }
    let pc;
    try {
      pc = new RTC({ iceServers: relayServers, iceTransportPolicy: "relay" });
    } catch (e) {
      resolve({ ok: false, reason: e?.message || "Couldn't start the test." });
      return;
    }
    const started = Date.now();
    const errors = [];
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        pc.close();
      } catch {
        /* ignore */
      }
      resolve(result);
    };
    const timer = setTimeout(() => {
      const detail = errors.length
        ? ` — ${candidateErrorText(errors[0].code, errors[0].text)}`
        : " — no relay answered in time";
      finish({ ok: false, reason: `Relay unreachable${detail}.`, errors });
    }, timeout);

    pc.addEventListener("icecandidate", (e) => {
      if (!e.candidate) return;
      if (!/\btyp relay\b/.test(e.candidate.candidate || "")) return;
      finish({
        ok: true,
        ms: Date.now() - started,
        server: e.candidate.url || relayServers[0].urls[0],
        errors,
      });
    });
    pc.addEventListener("icecandidateerror", (e) => {
      errors.push({ code: e.errorCode, text: e.errorText, url: e.url });
    });
    try {
      pc.createDataChannel("probe");
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch((e) => finish({ ok: false, reason: e?.message || "Couldn't start the test." }));
    } catch (e) {
      finish({ ok: false, reason: e?.message || "Couldn't start the test." });
    }
  });
}
