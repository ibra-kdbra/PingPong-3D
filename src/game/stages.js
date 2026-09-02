/**
 * Adventure campaign: twelve opponents of rising skill, each with an arena
 * theme and — from the rooftop on — a physics twist. AI fields: speed
 * (paddle units/s), error (shot noise — lower is deadlier), reactDelay
 * (s before tracking), aggression (0..1 flat drives), spin (0..1 sidespin
 * on its shots), spinRead (0..1 how well it anticipates your curve).
 *
 * physics: optional { gravity, wind, netHeight, restitution } overrides.
 * lines: what the opponent says when they win / lose a point.
 */
export const STAGES = [
  {
    name: "Backyard",
    opponent: "Botan",
    tagline: "A cheerful rookie who telegraphs every shot.",
    winScore: 5,
    ai: { speed: 5, error: 1.7, reactDelay: 0.35, aggression: 0.15 },
    theme: { bg: "#131726", accent: "#4cc8ff", table: "#1d5c8f", grid: ["#2b8fd8", "#173a5e"] },
    lines: { win: ["Yay!", "Did you see that?"], lose: ["Oops.", "Again, again!"] },
  },
  {
    name: "Club Night",
    opponent: "Miko",
    tagline: "Steady hands. Rarely blinks.",
    winScore: 5,
    ai: { speed: 7, error: 1.25, reactDelay: 0.28, aggression: 0.2, spinRead: 0.2 },
    theme: { bg: "#0f1d22", accent: "#3fe0c0", table: "#166655", grid: ["#2bd8b4", "#0e5040"] },
    lines: { win: ["Steady.", "Patience wins."], lose: ["Noted.", "Fair."] },
  },
  {
    name: "Rooftop",
    opponent: "Aster",
    tagline: "Loves a cross-court winner. Mind the breeze.",
    winScore: 7,
    ai: { speed: 8.5, error: 1.0, reactDelay: 0.24, aggression: 0.3, spin: 0.3, spinRead: 0.3 },
    physics: { wind: 2.5 },
    modifier: "Crosswind",
    theme: { bg: "#161228", accent: "#a88bff", table: "#463680", grid: ["#8a6bf0", "#332560"] },
    lines: { win: ["Cross-court, darling.", "Wind's on my side."], lose: ["Gust got me.", "Cheeky."] },
  },
  {
    name: "Neon Hall",
    opponent: "Rin",
    tagline: "Fast feet, faster flat drives.",
    winScore: 7,
    ai: { speed: 10, error: 0.8, reactDelay: 0.2, aggression: 0.4, spin: 0.35, spinRead: 0.4 },
    theme: { bg: "#1f1226", accent: "#f07ad0", table: "#77306a", grid: ["#d85ec0", "#571f4e"] },
    lines: { win: ["Too slow.", "Flat and fast."], lose: ["Tch.", "Lucky."] },
  },
  {
    name: "Moon Base",
    opponent: "Luna",
    tagline: "One-sixth gravity. Every lob hangs forever.",
    winScore: 7,
    ai: { speed: 10, error: 0.85, reactDelay: 0.22, aggression: 0.25, spin: 0.3, spinRead: 0.5 },
    physics: { gravity: -16 },
    modifier: "Low gravity",
    theme: { bg: "#0b0f1e", accent: "#dfe6ff", table: "#3c4670", grid: ["#8d9bd6", "#2a3358"] },
    lines: { win: ["Float like that.", "Up here, time is slow."], lose: ["Heavy hit.", "Grounded."] },
  },
  {
    name: "Foundry",
    opponent: "Volt",
    tagline: "Plays angles you didn't know existed.",
    winScore: 7,
    ai: { speed: 11.5, error: 0.62, reactDelay: 0.16, aggression: 0.5, spin: 0.55, spinRead: 0.5 },
    theme: { bg: "#20160c", accent: "#ffb04d", table: "#8a5a1e", grid: ["#e09a3c", "#5e3c10"] },
    lines: { win: ["Angles.", "Sparks fly."], lose: ["Short circuit.", "Recalibrating."] },
  },
  {
    name: "Glasshouse",
    opponent: "Karo",
    tagline: "A glass table that bounces like a trampoline.",
    winScore: 7,
    ai: { speed: 12, error: 0.58, reactDelay: 0.14, aggression: 0.45, spin: 0.4, spinRead: 0.6 },
    physics: { restitution: 0.92 },
    modifier: "Bouncy table",
    theme: { bg: "#0e1f12", accent: "#6fe06a", table: "#2c6e35", grid: ["#4bc85a", "#1c5228"] },
    lines: { win: ["Bounce with it.", "Patience — or perfection."], lose: ["Hm. Growing.", "Well placed."] },
  },
  {
    name: "High Wire",
    opponent: "Sable",
    tagline: "The net is raised. Drives die; lobs live.",
    winScore: 7,
    ai: { speed: 12.5, error: 0.5, reactDelay: 0.13, aggression: 0.2, spin: 0.5, spinRead: 0.65 },
    physics: { netHeight: 1.45 },
    modifier: "High net",
    theme: { bg: "#1a1020", accent: "#ff9ecb", table: "#5c2a50", grid: ["#c85ea0", "#40183a"] },
    lines: { win: ["Over, not through.", "Mind the wire."], lose: ["Threaded it.", "Fine."] },
  },
  {
    name: "Summit",
    opponent: "Nyx",
    tagline: "Thin air, strong gusts, no mistakes.",
    winScore: 9,
    ai: { speed: 14, error: 0.4, reactDelay: 0.1, aggression: 0.6, spin: 0.6, spinRead: 0.75 },
    physics: { wind: 4.5 },
    modifier: "Strong wind",
    theme: { bg: "#201d0b", accent: "#ffe14d", table: "#8a7a1e", grid: ["#d8c23c", "#5e5410"] },
    lines: { win: ["The mountain agrees.", "Breathe."], lose: ["...", "Interesting."] },
  },
  {
    name: "Deep Freeze",
    opponent: "Frost",
    tagline: "A frozen table. The ball barely bounces.",
    winScore: 9,
    ai: { speed: 14, error: 0.38, reactDelay: 0.1, aggression: 0.35, spin: 0.5, spinRead: 0.8 },
    physics: { restitution: 0.68 },
    modifier: "Dead bounce",
    theme: { bg: "#0a1520", accent: "#9ee8ff", table: "#2f5f7a", grid: ["#6cc4e8", "#1e4257"] },
    lines: { win: ["Cold, isn't it.", "Nothing gets up."], lose: ["Thaw.", "Warm hands."] },
  },
  {
    name: "Storm Deck",
    opponent: "Gale",
    tagline: "A crosswind that rewrites every shot.",
    winScore: 9,
    ai: { speed: 15, error: 0.32, reactDelay: 0.08, aggression: 0.7, spin: 0.7, spinRead: 0.85 },
    physics: { wind: -7 },
    modifier: "Gale wind",
    theme: { bg: "#111827", accent: "#7ab8ff", table: "#2a4f8a", grid: ["#4f8fe0", "#1b3560"] },
    lines: { win: ["Read the wind.", "Blown away."], lose: ["Calm shot.", "Eye of the storm."] },
  },
  {
    name: "The Machine",
    opponent: "Unit 09",
    tagline: "It does not get tired. It does not miss. Almost.",
    winScore: 11,
    ai: { speed: 16.5, error: 0.24, reactDelay: 0.06, aggression: 0.85, spin: 0.8, spinRead: 0.95 },
    theme: { bg: "#1c0a0c", accent: "#ff5d5d", table: "#7c2430", grid: ["#d83c48", "#571018"] },
    lines: { win: ["PROBABILITY: EXPECTED.", "ADJUSTING."], lose: ["ANOMALY.", "RECOMPUTING."] },
  },
];

/** Theme used for local two-player versus matches. */
export const VERSUS_THEME = {
  bg: "#131726",
  accent: "#4cc8ff",
  table: "#1d5c8f",
  grid: ["#2b8fd8", "#173a5e"],
};

/**
 * Star rating for a won stage: 1 for the win, 2 if the opponent was held
 * under half the target, 3 for a shutout.
 */
export function starsFor(stage, p1, p2) {
  if (p1 < stage.winScore) return 0;
  if (p2 === 0) return 3;
  if (p2 * 2 < stage.winScore) return 2;
  return 1;
}
