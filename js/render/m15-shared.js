// ── M15 FRAME SHARED HELPERS ─────────────────────────────────────────────────
// Frame/watermark drawing shared by every M15-frame-based renderer (the
// single-column m15.js and the 2-column m15-2col.js). Layout of the text
// itself (title/rules boxes, column count) stays per-renderer.

import { loadImage } from './assets.js?v=1';
import { scaleX, scaleY, scaleWidth, scaleHeight } from './text.js?v=13';
import { DIVIDER_COLOR, DIVIDER_LINE_WIDTH_FRAC } from '../config.js?v=3';

export const CC_W = 2010;
export const CC_H = 2814;

const COLOR_TO_FRAME = {
  W: 'w', U: 'u', B: 'b', R: 'r', G: 'g', M: 'm', C: 'l',
};

export const WATERMARK_BOUNDS  = { x: 0.5, y: 0.516, width: 0.75, height: 0.4562 };
export const WATERMARK_OPACITY = 0.2;

// Soft blend width (fraction of card width) for the two-color split.
const SPLIT_BAND = 0.06;

export function frameSrc(color) {
  return `assets/frames/m15/fullTextAlt/${COLOR_TO_FRAME[color] || 'l'}.png`;
}

export async function drawFrames(ctx, w, h, model) {
  const primary = await loadImage(frameSrc(model.primaryColor));
  ctx.drawImage(primary, 0, 0, w, h);

  if (model.primaryColor !== model.secondaryColor) {
    const secondary = await loadImage(frameSrc(model.secondaryColor));
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const tc = tmp.getContext('2d');
    tc.drawImage(secondary, 0, 0, w, h);

    // Keep the secondary frame on the right, sized to its pip share. The split
    // sits at splitRatio·w (primary on the left) with a soft blend band.
    const splitX = model.splitRatio * w;
    const band   = w * SPLIT_BAND;
    tc.globalCompositeOperation = 'destination-in';
    const g = tc.createLinearGradient(splitX - band / 2, 0, splitX + band / 2, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,1)');
    tc.fillStyle = g;
    tc.fillRect(0, 0, w, h);

    ctx.drawImage(tmp, 0, 0);
  }
}

export async function drawWatermark(ctx, card, model) {
  const { source, leftHex, rightHex } = model.watermark;
  if (!source) return;

  let wm;
  try { wm = await loadImage(source); } catch { return; }
  const w  = card.width, h = card.height;
  const bounds = WATERMARK_BOUNDS;

  const bx = scaleX(bounds.x - bounds.width / 2, card);
  const by = scaleY(bounds.y - bounds.height / 2, card);
  const bw = scaleWidth(bounds.width, card);
  const bh = scaleHeight(bounds.height, card);

  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const tc = tmp.getContext('2d');

  tc.drawImage(wm, bx, by, bw, bh);

  tc.globalCompositeOperation = 'source-in';
  // Match the frame split: align the color transition to splitRatio·cardWidth,
  // expressed as a fraction of the watermark bounds.
  const splitX = model.splitRatio * w;
  const sf     = Math.max(0, Math.min(1, (splitX - bx) / bw));
  const band   = 0.05;
  const grad = tc.createLinearGradient(bx, 0, bx + bw, 0);
  grad.addColorStop(0,                       leftHex);
  grad.addColorStop(Math.max(0, sf - band),  leftHex);
  grad.addColorStop(Math.min(1, sf + band),  rightHex);
  grad.addColorStop(1,                       rightHex);
  tc.fillStyle = grad;
  tc.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalAlpha = WATERMARK_OPACITY;
  ctx.drawImage(tmp, 0, 0);
  ctx.restore();
}

// A light horizontal rule across the vfill gap between the spell block and
// the land/token block. xFrac/widthFrac/yFrac are fractional card
// coordinates, same convention as everything else here.
export function drawSectionDivider(ctx, card, xFrac, yFrac, widthFrac) {
  const x0 = scaleX(xFrac, card);
  const y  = scaleY(yFrac, card);
  const w  = scaleWidth(widthFrac, card);
  ctx.save();
  ctx.strokeStyle = DIVIDER_COLOR;
  ctx.lineWidth = Math.max(1, Math.round(scaleHeight(DIVIDER_LINE_WIDTH_FRAC, card)));
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x0 + w, y);
  ctx.stroke();
  ctx.restore();
}
