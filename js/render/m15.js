// ── M15 CARD CONJURER RENDERER ───────────────────────────────────────────────
// Owns all M15 frame layout: coordinates, font names, frame paths, watermark
// bounds, pip position, corner radius.
// Consumes the style-agnostic deck model and self-registers with the registry.

import { register }          from './registry.js?v=1';
import { loadImage, manaSrc, MANA_CODES, ensureFonts } from './assets.js?v=1';
import { cutRoundedCorners } from './canvas-util.js?v=2';
import { drawColorPips }     from './pips.js?v=1';
import { buildTextMarkup }   from './markup.js?v=6';
import { writeText }         from './text.js?v=5';
import {
  CC_W, CC_H, frameSrc, drawFrames, drawWatermark,
} from './m15-shared.js?v=3';

// ── CONSTANTS ────────────────────────────────────────────────────────────────

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
