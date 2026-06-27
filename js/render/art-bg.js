// ── ART-BACKGROUND RENDERER ───────────────────────────────────────────────────
// Frameless style: full-bleed background art (deck's highest-rarity card, or a
// user-supplied URL, or a color-identity gradient fallback) → frosted glass panel
// → title → color pips → rules text → rounded corners. No CC frame/watermark.

import { register }            from './registry.js';
import { loadImage, ensureFonts } from './assets.js';
import { COLOR_HEX }           from '../config.js';
import { cutRoundedCorners, roundRectPath } from './canvas-util.js';
import { drawColorPips }       from './pips.js';
import { buildTextMarkup }     from './markup.js';
import { writeText }           from './text.js';

// ── CONSTANTS ────────────────────────────────────────────────────────────────

const CC_W = 2010;
const CC_H = 2814;

// Frosted panel covering the text area (fractional coordinates).
const PANEL = { x: 0.05, y: 0.045, width: 0.90, height: 0.905 };

const TITLE_TEXTOBJ = {
  font: 'belerenb',
  x: 0.088, y: 0.060, width: 0.824, height: 0.055, size: 0.040,
};

const RULES_TEXTOBJ = {
  font: 'mplantin',
  x: 0.088, y: 0.140, width: 0.824, height: 0.790, size: 0.0362,
};

// Title/content separator + deck-color outline.
const SEPARATOR    = { y: 0.128, x0: 0.088, x1: 0.912 };
const OUTLINE_FRAC = 0.013;   // outline thickness as a fraction of card width

// ── DECK-COLOR GRADIENT ────────────────────────────────────────────────────────
// Horizontal gradient across the deck's WUBRG color identity (single color → flat).

function colorGradient(ctx, x0, x1, model) {
  const hexes = model.colorIdentity.map(c => COLOR_HEX[c] ?? COLOR_HEX.C);
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  if (hexes.length === 1) {
    g.addColorStop(0, hexes[0]); g.addColorStop(1, hexes[0]);
  } else {
    hexes.forEach((hex, i) => g.addColorStop(i / (hexes.length - 1), hex));
  }
  return g;
}

// ── DRAW BACKGROUND ────────────────────────────────────────────────────────────

// Cover-fit the art image (center-cropped) over the whole canvas.
// Scryfall art_crop is only ~626px wide, so it's upscaled heavily here — use
// high-quality resampling so it reads smoother rather than blocky.
function drawArtImage(ctx, w, h, img) {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

// Soft diagonal gradient built from the deck's color identity.
function drawGradient(ctx, w, h, model) {
  const hexes = model.colorIdentity.map(c => COLOR_HEX[c] ?? COLOR_HEX.C);
  const grad = ctx.createLinearGradient(0, 0, w, h);
  if (hexes.length === 1) {
    grad.addColorStop(0, '#f4f1e8');
    grad.addColorStop(1, hexes[0]);
  } else {
    hexes.forEach((hex, i) => grad.addColorStop(i / (hexes.length - 1), hex));
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

async function drawArtBackground(ctx, w, h, model) {
  if (model.artUrl) {
    try {
      drawArtImage(ctx, w, h, await loadImage(model.artUrl));
      return;
    } catch { /* CORS / 404 → fall through to gradient */ }
  }
  drawGradient(ctx, w, h, model);
}

// ── DRAW GLASS PANEL ───────────────────────────────────────────────────────────
// Frosted effect: blur a snapshot of the art behind the panel, then overlay a
// translucent white fill so dark text stays legible.

function drawGlassPanel(ctx, w, h, model) {
  const px = PANEL.x * w, py = PANEL.y * h;
  const pw = PANEL.width * w, ph = PANEL.height * h;
  const r  = Math.round(w * 0.028);

  const snap = document.createElement('canvas');
  snap.width = w; snap.height = h;
  snap.getContext('2d').drawImage(ctx.canvas, 0, 0);

  ctx.save();
  roundRectPath(ctx, px, py, pw, ph, r);
  ctx.clip();
  ctx.filter = `blur(${Math.round(w * 0.012)}px)`;
  ctx.drawImage(snap, 0, 0);
  ctx.filter = 'none';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.62)';
  ctx.fillRect(px, py, pw, ph);
  ctx.restore();

  // Deck-color outline around the content panel (matches the card-edge outline).
  roundRectPath(ctx, px, py, pw, ph, r);
  ctx.lineWidth   = Math.round(w * 0.006);
  ctx.strokeStyle = colorGradient(ctx, px, px + pw, model);
  ctx.stroke();
}

// ── SEPARATOR + OUTLINE ─────────────────────────────────────────────────────────

// Thin deck-colored rule between the title and the card contents.
function drawSeparator(ctx, w, h, model) {
  const y  = SEPARATOR.y * h;
  const x0 = SEPARATOR.x0 * w, x1 = SEPARATOR.x1 * w;
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = colorGradient(ctx, x0, x1, model);
  ctx.lineWidth   = Math.max(2, Math.round(w * 0.004));
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.restore();
}

// Small deck-color outline hugging the rounded card edge. Drawn after the corners
// are cut so it traces the final rounded silhouette.
function drawColorOutline(ctx, w, h, model) {
  const lw    = Math.round(w * OUTLINE_FRAC);
  const inset = lw / 2;
  const r     = Math.round(w * 0.045);          // matches cutRoundedCorners
  ctx.save();
  ctx.lineWidth   = lw;
  ctx.strokeStyle = colorGradient(ctx, 0, w, model);
  roundRectPath(ctx, inset, inset, w - 2 * inset, h - 2 * inset, Math.max(0, r - inset));
  ctx.stroke();
  ctx.restore();
}

// ── RENDERER OBJECT ───────────────────────────────────────────────────────────

const artBg = {
  key:    'art-bg',
  label:  'Art background',
  width:  CC_W,
  height: CC_H,

  async preload(model) {
    const loads = [];
    if (model.artUrl) loads.push(loadImage(model.artUrl).catch(() => null));
    await Promise.all(loads);
    await ensureFonts();
  },

  async render(canvas, model) {
    canvas.width  = CC_W;
    canvas.height = CC_H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, CC_W, CC_H);

    const card = { width: CC_W, height: CC_H, marginX: 0, marginY: 0 };

    // 1. Background art (or gradient fallback)
    await drawArtBackground(ctx, CC_W, CC_H, model);

    // 2. Frosted glass panel over the text area
    drawGlassPanel(ctx, CC_W, CC_H, model);

    // 3. Title
    await writeText(ctx, card, { ...TITLE_TEXTOBJ, text: `{bold}${model.name}{/bold}` });

    // 4. Color-identity pips
    await drawColorPips(ctx, card, model);

    // 5. Title/content separator
    drawSeparator(ctx, CC_W, CC_H, model);

    // 6. Rules text
    await writeText(ctx, card, { ...RULES_TEXTOBJ, text: buildTextMarkup(model) });

    // 7. Rounded corners
    cutRoundedCorners(ctx, CC_W, CC_H);

    // 8. Deck-color outline (after corner cut, traces the rounded edge)
    drawColorOutline(ctx, CC_W, CC_H, model);
  },
};

register(artBg);
export default artBg;
