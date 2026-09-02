/**
 * Tiny shared channel for per-frame visual effects that don't belong in
 * React state: written by whoever triggers them, read by the camera rig
 * and scene each frame. No subscriptions, no re-renders.
 */
export const fx = {
  /** Camera shake energy, decays every frame. */
  shake: 0,
};

export function kick(amount) {
  fx.shake = Math.min(1, fx.shake + amount);
}
