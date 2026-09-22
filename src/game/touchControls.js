/**
 * Step buttons held on a touch screen. Written by the on-screen buttons,
 * read by the match loop every frame — the touch twin of holding W or S,
 * so walking speed, the glide, the camera and online sync are all shared.
 */
export const touchSteps = { fwd: false, back: false };

export function releaseSteps() {
  touchSteps.fwd = false;
  touchSteps.back = false;
}

/**
 * Should the step buttons show? A phone or tablet says so up front; a
 * laptop with a touchscreen reports a fine pointer, so the first real
 * touch turns them on as well.
 */
export function prefersTouch() {
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}
