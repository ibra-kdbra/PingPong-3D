/**
 * Collision filter groups. The paddle only collides with the ball — without
 * this, sweeping the paddle into the invisible boundary walls fires its
 * onCollide and lets players farm score without ever touching the ball.
 */
export const GROUP_BALL = 1;
export const GROUP_STATIC = 2;
export const GROUP_PADDLE = 4;
