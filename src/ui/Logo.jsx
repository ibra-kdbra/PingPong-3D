/**
 * PingPong 3D mark — paddle blade seen slightly from above, with the ball
 * leaving a curved spin arc. Inline SVG with explicit fills (no currentColor)
 * so it renders identically on the navy game background and on white.
 * Source of truth: public/images/logo.svg (transparent) / icon.svg (app icon).
 */
export default function Logo({ size = 40 }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="-38" y="96" width="76" height="196" rx="34" fill="#b98a4e" transform="translate(226 268) rotate(45)" />
      <ellipse cx="226" cy="268" rx="150" ry="132" fill="#c8452f" transform="rotate(-22 226 268)" />
      <path d="M334 156 C 338 90, 362 62, 392 66" fill="none" stroke="#4cc8ff" strokeWidth="30" strokeLinecap="round" />
      <circle cx="446" cy="94" r="48" fill="#4cc8ff" />
    </svg>
  );
}
