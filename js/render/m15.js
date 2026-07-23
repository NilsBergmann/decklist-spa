// ── M15 CARD CONJURER RENDERER ───────────────────────────────────────────────
// Owns all M15 frame layout: coordinates, font names, frame paths, watermark
// bounds, pip position, corner radius.
// Consumes the style-agnostic deck model and self-registers with the registry.

import { register }          from './registry.js?v=1';
import { loadImage, manaSrc, MANA_CODES, ensureFonts } from './assets.js?v=1';
import { cutRoundedCorners } from './canvas-util.js?v=2';
import { drawColorPips }     from './pips.js?v=1';
import { buildSectionsMarkup } from './markup.js?v=8';
import { writeText, layoutText, scaleWidth, scaleHeight } from './text.js?v=8';
import {
  CC_W, CC_H, frameSrc, drawFrames, drawWatermark,
} from './m15-shared.js?v=6';

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

// Squeeze leading before shrinking font size on overflow (same range as the
// 2-column style). Land/Token sections are pushed down to sit flush against
// the bottom of the box, separated from the rest by a single flexible gap
// (vfill) that absorbs unused space — every row everywhere keeps the same
// natural spacing, rather than any row stretching or squeezing to fill it.
const LINE_HEIGHT_MULT     = 1.15;
const MIN_LINE_HEIGHT_MULT = 0.95;
const MIN_BLOCK_GAP        = 0.012;

const BOTTOM_TYPES = new Set(['Land', 'Token']);

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

    // 5. Rules text: spell sections on top, Land/Token pushed down flush
    // against the bottom of the box, separated by a single flexible gap
    // (vfill) — every row keeps the same natural spacing throughout.
    const topSections    = model.sections.filter(s => !BOTTOM_TYPES.has(s.type));
    const bottomSections = model.sections.filter(s => BOTTOM_TYPES.has(s.type));
    const hasBoth = topSections.length && bottomSections.length;

    const topMarkup    = topSections.length    ? buildSectionsMarkup(topSections)    : '';
    const bottomMarkup = bottomSections.length ? buildSectionsMarkup(bottomSections) : '';

    const boxWidthPx  = scaleWidth(RULES_TEXTOBJ.width, card);
    const boxHeightPx = scaleHeight(RULES_TEXTOBJ.height, card);
    const minGapPx    = scaleHeight(MIN_BLOCK_GAP, card);

    async function measure(fontSizePx, lhMult) {
      const topLines = topSections.length ? await layoutText(ctx, topMarkup, {
        fontFamily: RULES_TEXTOBJ.font, fontSize: fontSizePx, maxWidth: boxWidthPx, lineHeightMult: lhMult, oneLinePerRow: true,
      }) : [];
      const bottomLines = bottomSections.length ? await layoutText(ctx, bottomMarkup, {
        fontFamily: RULES_TEXTOBJ.font, fontSize: fontSizePx, maxWidth: boxWidthPx, lineHeightMult: lhMult, oneLinePerRow: true,
      }) : [];
      return {
        topH: topLines.reduce((s, l) => s + l.lineHeight, 0),
        bottomH: bottomLines.reduce((s, l) => s + l.lineHeight, 0),
      };
    }

    let fontSizePx = Math.round(RULES_TEXTOBJ.size * CC_H);
    const minFontSizePx = Math.round(fontSizePx * 0.5);
    let lhMult = LINE_HEIGHT_MULT, topH = 0, bottomH = 0;
    for (;;) {
      lhMult = LINE_HEIGHT_MULT;
      for (;;) {
        ({ topH, bottomH } = await measure(fontSizePx, lhMult));
        const needed = topH + (hasBoth ? minGapPx : 0) + bottomH;
        if (needed <= boxHeightPx || lhMult <= MIN_LINE_HEIGHT_MULT) break;
        lhMult = Math.max(MIN_LINE_HEIGHT_MULT, lhMult - 0.02);
      }
      const needed = topH + (hasBoth ? minGapPx : 0) + bottomH;
      if (needed <= boxHeightPx || fontSizePx <= minFontSizePx) break;
      fontSizePx -= 1;
    }

    const sharedSize = fontSizePx / CC_H;
    const gapPx = hasBoth ? Math.max(minGapPx, boxHeightPx - topH - bottomH) : 0;

    if (topSections.length) {
      await writeText(ctx, card, {
        ...RULES_TEXTOBJ, height: (topH * 1.002) / CC_H, size: sharedSize,
        lineHeightMult: lhMult, minLineHeightMult: lhMult, oneLinePerRow: true, text: topMarkup,
      });
    }
    if (bottomSections.length) {
      await writeText(ctx, card, {
        ...RULES_TEXTOBJ, y: RULES_TEXTOBJ.y + (topH + gapPx) / CC_H,
        height: (bottomH * 1.002) / CC_H, size: sharedSize,
        lineHeightMult: lhMult, minLineHeightMult: lhMult, oneLinePerRow: true, text: bottomMarkup,
      });
    }

    // 6. Rounded corners
    cutRoundedCorners(ctx, CC_W, CC_H);
  },
};

// Self-register
register(m15);
export default m15;
