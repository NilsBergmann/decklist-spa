// ── COVER-CARD RENDERER (Jumpstart 2022 front) ───────────────────────────────
// A pack/divider card: full-bleed art, the J22 frame overlay (black border +
// title band), a centered title + small-caps subtitle, a gold set symbol bottom
// -left, and mono+dual color pips bottom-right. Reproduces Card Conjurer's
// `j22Front` template; ignores the deck's card list.

import { register }            from './registry.js';
import { loadImage, manaSrc, ensureFonts } from './assets.js';
import { COLOR_HEX, GUILD_HYBRID }         from '../config.js';
import { cutRoundedCorners }   from './canvas-util.js';

const CC_W = 2010;
const CC_H = 2814;

const FRAME_SRC = 'assets/frames/jmpfront/j22Frame.png';

// Fractional coordinates from Card Conjurer's j22Front template.
const ART_BOUNDS = { x: 0.0474, y: 0.0353, width: 0.9054, height: 0.9296 };
const TITLE      = { x: 0.0474, y: 0.726, width: 0.9054, height: 0.0534, size: 0.0534, font: 'gothammedium' };
const SUBTITLE   = { x: 0.0474, y: 0.777, width: 0.9054, height: 0.030,  size: 0.030,  font: 'belerenbsc', bold: true };

// ── ART (full-bleed within the frame window, gradient fallback) ─────────────────

async function drawCoverArt(ctx, w, h, model) {
  const bx = ART_BOUNDS.x * w, by = ART_BOUNDS.y * h;
  const bw = ART_BOUNDS.width * w, bh = ART_BOUNDS.height * h;
  ctx.save();
  ctx.beginPath();
  ctx.rect(bx, by, bw, bh);
  ctx.clip();
  if (model.artUrl) {
    try {
      const img = await loadImage(model.artUrl);
      const scale = Math.max(bw / img.width, bh / img.height);
      const dw = img.width * scale, dh = img.height * scale;
      // art_crop is low-res (~626px) and gets upscaled — resample at high quality.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, bx + (bw - dw) / 2, by + (bh - dh) / 2, dw, dh);
      ctx.restore();
      return;
    } catch { /* CORS / 404 → gradient fallback */ }
  }
  const hexes = model.colorIdentity.map(c => COLOR_HEX[c] ?? COLOR_HEX.C);
  const g = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
  if (hexes.length === 1) { g.addColorStop(0, '#f4f1e8'); g.addColorStop(1, hexes[0]); }
  else hexes.forEach((hx, i) => g.addColorStop(i / (hexes.length - 1), hx));
  ctx.fillStyle = g;
  ctx.fillRect(bx, by, bw, bh);
  ctx.restore();
}

// ── CENTERED, AUTO-FIT SINGLE LINE ──────────────────────────────────────────────

function drawCenteredLine(ctx, text, o, w, h) {
  if (!text) return;
  const maxW = o.width * w;
  let size = Math.round(o.size * h);
  const setFont = s => { ctx.font = `${o.bold ? 'bold ' : ''}${s}px ${o.font}`; };
  setFont(size);
  while (size > 10 && ctx.measureText(text).width > maxW) { size -= 2; setFont(size); }
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'white';
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = h * 0.006;
  ctx.fillText(text, (o.x + o.width / 2) * w, (o.y + o.height / 2) * h);
  ctx.restore();
}

// ── GOLD SET SYMBOL (bottom-left) ───────────────────────────────────────────────

async function drawSetSymbol(ctx, w, h, model) {
  const src = model.watermark?.source;
  if (!src) return;
  let img;
  try { img = await loadImage(src); } catch { return; }

  const boxW = 0.16 * w, boxH = 0.105 * h;
  const ar = img.width / img.height;
  let dh = boxH, dw = dh * ar;
  if (dw > boxW) { dw = boxW; dh = dw / ar; }
  const dx = 0.05 * w;
  const dy = 0.955 * h - dh;          // bottom-anchored

  const t = document.createElement('canvas');
  t.width = Math.max(1, Math.ceil(dw)); t.height = Math.max(1, Math.ceil(dh));
  const tc = t.getContext('2d');
  tc.drawImage(img, 0, 0, dw, dh);
  tc.globalCompositeOperation = 'source-in';
  const g = tc.createLinearGradient(0, 0, 0, dh);
  g.addColorStop(0, '#e8cf7a'); g.addColorStop(0.5, '#c9a227'); g.addColorStop(1, '#8a6a14');
  tc.fillStyle = g;
  tc.fillRect(0, 0, dw, dh);

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = h * 0.004;
  ctx.drawImage(t, dx, dy);
  ctx.restore();
}

// ── COLOR PIPS (bottom-right): mono primary + two-color split ───────────────────

async function drawCoverPips(ctx, w, h, model) {
  const id = model.colorIdentity;
  let codes;
  if (id.length === 2) {
    const guild = GUILD_HYBRID[id.join('')];
    codes = [model.primaryColor.toLowerCase(), guild].filter(Boolean);
  } else if (id.length === 1) {
    codes = [id[0].toLowerCase()];
  } else {
    codes = id.map(c => c.toLowerCase());
  }

  const imgs = [];
  for (const code of codes) {
    try { imgs.push(await loadImage(manaSrc(code))); } catch { /* skip */ }
  }
  if (!imgs.length) return;

  const size = 0.082 * w;
  const gap  = 0.018 * w;
  const totalW = imgs.length * size + (imgs.length - 1) * gap;
  let x = 0.935 * w - totalW;
  const y = 0.918 * h - size / 2;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = h * 0.004;
  for (const img of imgs) { ctx.drawImage(img, x, y, size, size); x += size + gap; }
  ctx.restore();
}

// ── RENDERER OBJECT ───────────────────────────────────────────────────────────

const cover = {
  key:    'cover',
  label:  'Cover card (Jumpstart)',
  width:  CC_W,
  height: CC_H,

  async preload(model) {
    const loads = [loadImage(FRAME_SRC)];
    if (model.artUrl)          loads.push(loadImage(model.artUrl).catch(() => null));
    if (model.watermark?.source) loads.push(loadImage(model.watermark.source).catch(() => null));
    await Promise.all(loads);
    // Explicitly load the cover fonts so canvas text doesn't fall back.
    try {
      await Promise.all([
        document.fonts.load(`${TITLE.size * CC_H}px ${TITLE.font}`),
        document.fonts.load(`bold ${SUBTITLE.size * CC_H}px ${SUBTITLE.font}`),
      ]);
    } catch { /* ensureFonts below still waits */ }
    await ensureFonts();
  },

  async render(canvas, model) {
    canvas.width  = CC_W;
    canvas.height = CC_H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, CC_W, CC_H);

    // 1. Black base (border) + art window
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CC_W, CC_H);
    await drawCoverArt(ctx, CC_W, CC_H, model);

    // 2. J22 frame overlay (border + title band + bottom bar)
    ctx.drawImage(await loadImage(FRAME_SRC), 0, 0, CC_W, CC_H);

    // 3. Title + subtitle
    drawCenteredLine(ctx, model.name, TITLE, CC_W, CC_H);
    drawCenteredLine(ctx, model.subtitle, SUBTITLE, CC_W, CC_H);

    // 4. Gold set symbol (bottom-left) + color pips (bottom-right)
    await drawSetSymbol(ctx, CC_W, CC_H, model);
    await drawCoverPips(ctx, CC_W, CC_H, model);

    // 5. Rounded corners
    cutRoundedCorners(ctx, CC_W, CC_H);
  },
};

register(cover);
export default cover;
