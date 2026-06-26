// ── CANVAS UTILITIES ─────────────────────────────────────────────────────────

// Trace a rounded-rectangle sub-path (no fill/stroke). Falls back to arcTo when
// the native ctx.roundRect is unavailable.
export function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

// Cut rounded corners using destination-out, mirroring CC's technique.
// Corner radius ≈ 4.5% of card width.
export function cutRoundedCorners(ctx, w, h) {
  const r = Math.round(w * 0.045);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'black';

  const corners = [
    [0, 0, 0, r, r, 0],               // top-left
    [w, 0, w - r, 0, w, r],           // top-right
    [0, h, 0, h - r, r, h],           // bottom-left
    [w, h, w - r, h, w, h - r],       // bottom-right
  ];

  for (const [ox, oy, x1, y1, x2, y2] of corners) {
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(x1, y1);
    ctx.quadraticCurveTo(ox, oy, x2, y2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
