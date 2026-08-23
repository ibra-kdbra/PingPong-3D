/**
 * Level progression definitions.
 *
 * Each level tunes the physics (gravity, wind, ball size) and the visual
 * theme (background, floor, grid, accent). `hits` is the number of valid
 * paddle hits required to advance; the final level is endless.
 */
export const LEVELS = [
  {
    name: "Warm Up",
    hits: 8,
    gravity: -30,
    wind: 0,
    ballRadius: 0.5,
    accent: "#3ec7ff",
    bg: "#171720",
    floor: "#5081ca",
    grid: ["#11f1ff", "#0b50aa"],
  },
  {
    name: "Rookie",
    hits: 10,
    gravity: -36,
    wind: 0,
    ballRadius: 0.5,
    accent: "#40ffd9",
    bg: "#0f1d24",
    floor: "#3e8e7e",
    grid: ["#2affd5", "#0a6e5c"],
  },
  {
    name: "Amateur",
    hits: 12,
    gravity: -42,
    wind: 6,
    ballRadius: 0.48,
    accent: "#b78bff",
    bg: "#160f2d",
    floor: "#6d4fc0",
    grid: ["#a56bff", "#4527a0"],
  },
  {
    name: "Pro",
    hits: 14,
    gravity: -48,
    wind: 8,
    ballRadius: 0.46,
    accent: "#ff7ad9",
    bg: "#26102b",
    floor: "#b0479a",
    grid: ["#ff5ecb", "#7a1f68"],
  },
  {
    name: "Champion",
    hits: 16,
    gravity: -54,
    wind: 11,
    ballRadius: 0.44,
    accent: "#ffb14d",
    bg: "#26170b",
    floor: "#c77b2e",
    grid: ["#ffa53c", "#8a5410"],
  },
  {
    name: "Master",
    hits: 18,
    gravity: -60,
    wind: 14,
    ballRadius: 0.42,
    accent: "#7dff6e",
    bg: "#0d2411",
    floor: "#3f9e46",
    grid: ["#51ff62", "#1c6e2b"],
  },
  {
    name: "Legend",
    hits: 22,
    gravity: -66,
    wind: 18,
    ballRadius: 0.4,
    accent: "#ffe14d",
    bg: "#26220b",
    floor: "#bda32e",
    grid: ["#ffe23c", "#8a7a10"],
  },
  {
    name: "Immortal",
    hits: Infinity,
    gravity: -72,
    wind: 22,
    ballRadius: 0.38,
    accent: "#ff4d4d",
    bg: "#1d0708",
    floor: "#a12f2f",
    grid: ["#ff3c3c", "#7a1010"],
  },
];

export const MAX_LEVEL = LEVELS.length - 1;
