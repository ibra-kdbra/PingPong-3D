/**
 * On-screen controls held on a touch screen. Written by the buttons, read
 * by the match loop every frame — the touch twins of the keyboard and the
 * right mouse button, so everything downstream (walking speed, the glide,
 * the camera, technique on the hit, online sync) is shared.
 *
 *  fwd / back  step in toward the net / back from the table (W / S)
 *  loop / chop the stroke played if held when the paddle meets the ball
 *              (right mouse button / Space)
 */
export const touchHeld = { fwd: false, back: false, loop: false, chop: false };

export function releaseTouch() {
  touchHeld.fwd = false;
  touchHeld.back = false;
  touchHeld.loop = false;
  touchHeld.chop = false;
}

/**
 * Should the touch controls show? A phone or tablet says so up front; a
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
