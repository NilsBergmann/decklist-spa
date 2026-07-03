// ── M15 CARD CONJURER RENDERER ───────────────────────────────────────────────
// Owns all M15 frame layout: coordinates, font names, frame paths, watermark
// bounds, pip position, corner radius.
// Consumes the style-agnostic deck model and self-registers with the registry.

import { register }          from './registry.js?v=1';
import { loadImage, manaSrc, MANA_CODES, ensureFonts } from './assets.js?v=1';
import { cutRoundedCorners } from './canvas-util.js?v=1';
import { drawColorPips }     from './pips.js?v=1';
import { buildTextMarkup }   from './markup.js?v=1';
import { scaleX, scaleY, scaleWidth, scaleHeight, writeText } from './text.js?v=1';

// ── CONSTANTS ────────────────────────────────────────────────────────────────

const CC_W = 2010;
const CC_H = 2814;

const COLOR_TO_FRAME = {
  W: 'w', U: 'u', B: 'b', R: 'r', G: 'g', M: 'm', C: 'l',
};

const WATERMARK_BOUNDS  = { x: 0.5, y: 0.516, width: 0.75, height: 0.4562 };
const WATERMARK_OPACITY = 0.2;

// Soft blend width (fraction of card width) for the two-color split.
const SPLIT_BAND = 0.06;

// Title + rules text-box layout (fractional CC coordinates)
const TITLE_TEXTOBJ = {
  font:   'belerenb',
  x:      0.105,   y:     0.0522,
  width:  0.8096,  height: 0.0543,
  size:   0.0381,
};

const RULES_TEXTOBJ = {
  font:   'mplantin',
  x:      0.100,   y:     0.116,
  width:  0.826,   height: 0.800,
  size:   0.0362,
};

// ── PATH HELPERS ─────────────────────────────────────────────────────────────

function frameSrc(color) {
  return `assets/frames/m15/fullTextAlt/${COLOR_TO_FRAME[color] || 'l'}.png`;
}

// ── DRAW FRAMES ───────────────────────────────────────────────────────────────

async function drawFrames(ctx, w, h, model) {
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

// ── DRAW WATERMARK ────────────────────────────────────────────────────────────

async function drawWatermark(ctx, card, model) {
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

// ── RENDERER OBJECT ───────────────────────────────────────────────────────────

const m15 = {
  key:    'm15',
  label:  'Card Conjurer (M15)',
  width:  CC_W,
  height: CC_H,

  async preload(model) {
    const loads = [
      loadImage(frameSrc(model.primaryColor)),
      loadImage(frameSrc(model.secondaryColor)),
    ];
    if (model.watermark.source) loads.push(loadImage(model.watermark.source).catch(() => null));
    const pipCodes = model.colorIdentity.map(c => c.toLowerCase());
    for (const code of [...model.manaCodes, ...pipCodes]) {
      if (MANA_CODES.has(code.toLowerCase())) loads.push(loadImage(manaSrc(code)));
    }
    await Promise.all(loads);
    await ensureFonts();
  },

  async render(canvas, model) {
    canvas.width  = CC_W;
    canvas.height = CC_H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, CC_W, CC_H);

    const card = { width: CC_W, height: CC_H, marginX: 0, marginY: 0 };

    // 1. Frames
    await drawFrames(ctx, CC_W, CC_H, model);

    // 2. Watermark
    await drawWatermark(ctx, card, model);

    // 3. Color-identity pips
    await drawColorPips(ctx, card, model);

    // 4. Title text
    await writeText(ctx, card, {
      ...TITLE_TEXTOBJ,
      text: `{bold}${model.name}{/bold}`,
    });

    // 5. Rules text (markup built from model.sections)
    await writeText(ctx, card, {
      ...RULES_TEXTOBJ,
      text: buildTextMarkup(model),
    });

    // 6. Rounded corners
    cutRoundedCorners(ctx, CC_W, CC_H);
  },
};

// Self-register
register(m15);
export default m15;
