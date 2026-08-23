/**
 * Adventure campaign: eight opponents of rising skill, each with their own
 * arena theme. AI fields: speed (paddle m/s), error (shot noise — lower is
 * deadlier), reactDelay (s before tracking), aggression (0..1 flat drives).
 */
export const STAGES = [
  {
    name: "Backyard",
    opponent: "Botan",
    tagline: "A cheerful rookie who telegraphs every shot.",
    winScore: 5,
    ai: { speed: 5, error: 1.7, reactDelay: 0.35, aggression: 0.15 },
    theme: { bg: "#131726", accent: "#4cc8ff", table: "#1d5c8f", grid: ["#2b8fd8", "#173a5e"] },
  },
  {
    name: "Club Night",
    opponent: "Miko",
    tagline: "Steady hands. Rarely blinks.",
    winScore: 5,
    ai: { speed: 7, error: 1.25, reactDelay: 0.28, aggression: 0.2 },
    theme: { bg: "#0f1d22", accent: "#3fe0c0", table: "#166655", grid: ["#2bd8b4", "#0e5040"] },
  },
  {
    name: "Rooftop",
    opponent: "Aster",
    tagline: "Loves a cross-court winner.",
    winScore: 7,
    ai: { speed: 8.5, error: 1.0, reactDelay: 0.24, aggression: 0.3 },
    theme: { bg: "#161228", accent: "#a88bff", table: "#463680", grid: ["#8a6bf0", "#332560"] },
  },
  {
    name: "Neon Hall",
    opponent: "Rin",
    tagline: "Fast feet, faster flat drives.",
    winScore: 7,
    ai: { speed: 10, error: 0.8, reactDelay: 0.2, aggression: 0.38 },
    theme: { bg: "#1f1226", accent: "#f07ad0", table: "#77306a", grid: ["#d85ec0", "#571f4e"] },
  },
  {
    name: "Foundry",
    opponent: "Volt",
    tagline: "Plays angles you didn't know existed.",
    winScore: 7,
    ai: { speed: 11.5, error: 0.62, reactDelay: 0.16, aggression: 0.48 },
    theme: { bg: "#20160c", accent: "#ffb04d", table: "#8a5a1e", grid: ["#e09a3c", "#5e3c10"] },
  },
  {
    name: "Greenhouse",
    opponent: "Karo",
    tagline: "Returns everything. Be patient — or perfect.",
    winScore: 7,
    ai: { speed: 13, error: 0.5, reactDelay: 0.13, aggression: 0.55 },
    theme: { bg: "#0e1f12", accent: "#6fe06a", table: "#2c6e35", grid: ["#4bc85a", "#1c5228"] },
  },
  {
    name: "Summit",
    opponent: "Nyx",
    tagline: "One step from perfection.",
    winScore: 9,
    ai: { speed: 14.5, error: 0.38, reactDelay: 0.1, aggression: 0.65 },
    theme: { bg: "#201d0b", accent: "#ffe14d", table: "#8a7a1e", grid: ["#d8c23c", "#5e5410"] },
  },
  {
    name: "The Machine",
    opponent: "Unit 09",
    tagline: "It does not get tired. It does not miss. Almost.",
    winScore: 11,
    ai: { speed: 16, error: 0.26, reactDelay: 0.07, aggression: 0.8 },
    theme: { bg: "#1c0a0c", accent: "#ff5d5d", table: "#7c2430", grid: ["#d83c48", "#571018"] },
  },
];

/** Theme used for local two-player versus matches. */
export const VERSUS_THEME = {
  bg: "#131726",
  accent: "#4cc8ff",
  table: "#1d5c8f",
  grid: ["#2b8fd8", "#173a5e"],
};
