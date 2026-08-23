/** Minimal inline SVG icons — 20px grid, stroke inherits currentColor. */

const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

export function PauseIcon() {
  return (
    <svg {...base}>
      <path d="M7 4v12M13 4v12" />
    </svg>
  );
}

export function PlayIcon() {
  return (
    <svg {...base}>
      <path d="M6 4l10 6-10 6V4z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SoundIcon() {
  return (
    <svg {...base}>
      <path d="M3 8v4h3l4 3V5L6 8H3z" fill="currentColor" stroke="none" />
      <path d="M13 7a4 4 0 010 6M15.5 5a7 7 0 010 10" strokeWidth={1.6} />
    </svg>
  );
}

export function MutedIcon() {
  return (
    <svg {...base}>
      <path d="M3 8v4h3l4 3V5L6 8H3z" fill="currentColor" stroke="none" />
      <path d="M13 8l4 4M17 8l-4 4" strokeWidth={1.6} />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg {...base} strokeWidth={1.7}>
      <rect x="4.5" y="9" width="11" height="7.5" rx="1.5" />
      <path d="M7 9V6.5a3 3 0 016 0V9" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg {...base}>
      <path d="M4 10.5l4 4 8-9" />
    </svg>
  );
}

export function StarIcon() {
  return (
    <svg {...base} width={14} height={14} strokeWidth={1.6}>
      <path d="M10 2.5l2.3 4.7 5.2.8-3.8 3.7.9 5.2-4.6-2.5-4.6 2.5.9-5.2L2.5 8l5.2-.8L10 2.5z" />
    </svg>
  );
}

export function GitHubIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function BackIcon() {
  return (
    <svg {...base}>
      <path d="M12 4l-6 6 6 6" />
    </svg>
  );
}
