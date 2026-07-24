// ── M15 (2-COLUMN LANDS/TOKENS) CARD CONJURER RENDERER ──────────────────────
// Same M15 frame/watermark/pips as m15.js. Spells (Creature/Instants &
// Sorceries/Artifacts & Enchantments/Planeswalker) render as one full-width
// block on top, same as m15 — their rows carry costs and often-long names,
// which is exactly what got messy when squeezed into a half-width column.
// Land and Token rows are short (no cost, short names) and rarely need more
// than one line even in a narrow column, so only THEY split into two columns
// at the bottom, reclaiming vertical space without the wrapping mess a
// full-list column split caused.

import { register }          from './registry.js?v=1';
import { loadImage, manaSrc, MANA_CODES, ensureFonts } from './assets.js?v=1';
import { cutRoundedCorners } from './canvas-util.js?v=2';
import { drawColorPips }     from './pips.js?v=2';
import { buildSectionsMarkup, splitSectionsIntoColumns } from './markup.js?v=13';
import { writeText, layoutText, scaleWidth, scaleHeight } from './text.js?v=13';
import {
  CC_W, CC_H, frameSrc, drawFrames, drawWatermark, drawSectionDivider,
} from './m15-shared.js?v=12';

// ── CONSTANTS ────────────────────────────────────────────────────────────────

const TITLE_TEXTOBJ = {
  font:   'belerenb',
  x:      0.105,   y:     0.0522,
  width:  0.8096,  height: 0.0543,
  size:   0.0381,
};

// Same overall footprint as m15's single RULES_TEXTOBJ (x 0.100–0.926, width
// 0.826), split top/bottom, with the bottom further split into two columns.
const RULES_Y      = 0.116;
const RULES_HEIGHT = 0.800;
const RULES_X      = 0.100;
const RULES_WIDTH  = 0.826;
const COLUMN_GAP    = 0.03;
const COLUMN_WIDTH  = (RULES_WIDTH - COLUMN_GAP) / 2;
const MIN_BLOCK_GAP = 0.012;   // smallest allowed vfill between the spell block and the land/token block

// RULES_X/RULES_WIDTH's left/right margins aren't symmetric (0.100 vs 0.074 —
// the right edge, 0.926, already sits at the smaller/correct margin from the
// card edge) — background decoration (divider rules, zebra tint) widens to
// these margins instead, so it doesn't read as lopsided against the text's
// own (asymmetric) tab-stops/wrapping width, which stay untouched.
//
// The frame art itself is ALSO asymmetric left vs right (confirmed by
// pixel-sampling the rendered border with no watermark, which otherwise
// masks it): the right border is ~149px wide at the card's 2010px render
// width (matching the 0.074 mirrored margin below), but the left border is
// only ~134px — so mirroring the right margin onto the left, as the comment
// above used to do, left a real ~15px gap of plain background between the
// left border and the tint/divider. DECOR_LEFT_X uses that measured value
// directly instead. The left column's tint widens to match on its outer
// (left) edge only; the right column's outer (right) edge already sits at
// DECOR_RIGHT_X, so it's untouched.
const DECOR_RIGHT_MARGIN = 1 - (RULES_X + RULES_WIDTH);
const DECOR_LEFT_X        = 134 / CC_W;
const DECOR_WIDTH         = (1 - DECOR_RIGHT_MARGIN) - DECOR_LEFT_X;
const LEFT_COLUMN_DECOR_WIDTH = (RULES_X + COLUMN_WIDTH) - DECOR_LEFT_X;

const RULES_SIZE = 0.0362;   // same base as m15 — starting point for the shared-size search below

// Same leading range for the spell block and both land/token columns, so
// entries keep one consistent spacing throughout the whole card — the two
// blocks are separated by a single flexible gap (vfill) instead of each
// block's own rows being stretched or squeezed independently.
const LINE_HEIGHT_MULT     = 1.15;
const MIN_LINE_HEIGHT_MULT = 0.95;

const BOTTOM_TYPES = new Set(['Land', 'Token']);

// ── RENDERER OBJECT ───────────────────────────────────────────────────────────

const m152col = {
  key:    'm15-2col',
  label:  'Card Conjurer (M15, 2-column lands/tokens)',
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

    // 5. Rules text: spell sections as one full-width block, Land/Token
    // split into two columns underneath. Both blocks use the same
    // consistent, natural row spacing (no per-row stretching or squeezing
    // between them); instead, a single flexible gap (vfill) between the two
    // blocks absorbs whatever space is left over, so the land/token block
    // sits flush against the bottom of the card.
    const topSections    = model.sections.filter(s => !BOTTOM_TYPES.has(s.type));
    const bottomSections = model.sections.filter(s => BOTTOM_TYPES.has(s.type));
    const hasBoth = topSections.length && bottomSections.length;
    // Only split the bottom into two columns when there's more than one
    // section down there (Land + Token) — with just one (e.g. no tokens
    // created), splitting would strand it in the left column with the right
    // column sitting empty, so it uses the full width instead.
    const splitBottom = bottomSections.length >= 2;

    // Halved tab-stop (65 vs the 130 default) — this style's narrower
    // columns don't need as much indent for the bullet/name to look right.
    const topMarkup = topSections.length ? buildSectionsMarkup(topSections, { tabStop: 65 }) : '';
    let bottomMarkup = '', leftMarkup = '', rightMarkup = '';
    if (bottomSections.length) {
      // Land/Token rows skip the bullet entirely — rarity isn't meaningful
      // info for these, unlike real spells.
      if (splitBottom) {
        const [leftSections, rightSections] = splitSectionsIntoColumns(bottomSections);
        leftMarkup  = buildSectionsMarkup(leftSections, { showBullet: false });
        rightMarkup = buildSectionsMarkup(rightSections, { showBullet: false });
      } else {
        bottomMarkup = buildSectionsMarkup(bottomSections, { showBullet: false });
      }
    }

    const rulesWidthPx  = scaleWidth(RULES_WIDTH, card);
    const columnWidthPx = scaleWidth(COLUMN_WIDTH, card);
    const rulesHeightPx = scaleHeight(RULES_HEIGHT, card);
    const minGapPx      = scaleHeight(MIN_BLOCK_GAP, card);

    // oneLinePerRow: true throughout — a long name shrinks itself rather
    // than wrapping onto a second line, in both the spell block and the
    // (now much narrower, when split) land/token columns.
    async function measure(fontSizePx, lhMult) {
      const topLines = topSections.length ? await layoutText(ctx, topMarkup, {
        fontFamily: 'mplantin', fontSize: fontSizePx, maxWidth: rulesWidthPx, lineHeightMult: lhMult, oneLinePerRow: true,
      }) : [];
      const topH = topLines.reduce((s, l) => s + l.lineHeight, 0);

      let bottomH = 0;
      if (splitBottom) {
        const leftLines  = await layoutText(ctx, leftMarkup,  { fontFamily: 'mplantin', fontSize: fontSizePx, maxWidth: columnWidthPx, lineHeightMult: lhMult, oneLinePerRow: true });
        const rightLines = await layoutText(ctx, rightMarkup, { fontFamily: 'mplantin', fontSize: fontSizePx, maxWidth: columnWidthPx, lineHeightMult: lhMult, oneLinePerRow: true });
        bottomH = Math.max(
          leftLines.reduce((s, l) => s + l.lineHeight, 0),
          rightLines.reduce((s, l) => s + l.lineHeight, 0),
        );
      } else if (bottomSections.length) {
        const bottomLines = await layoutText(ctx, bottomMarkup, {
          fontFamily: 'mplantin', fontSize: fontSizePx, maxWidth: rulesWidthPx, lineHeightMult: lhMult, oneLinePerRow: true,
        });
        bottomH = bottomLines.reduce((s, l) => s + l.lineHeight, 0);
      }
      return { topH, bottomH };
    }

    let fontSizePx = Math.round(RULES_SIZE * CC_H);
    const minFontSizePx = Math.round(fontSizePx * 0.5);
    let lhMult = LINE_HEIGHT_MULT, topH = 0, bottomH = 0;
    for (;;) {
      lhMult = LINE_HEIGHT_MULT;
      for (;;) {
        ({ topH, bottomH } = await measure(fontSizePx, lhMult));
        const needed = topH + (hasBoth ? minGapPx : 0) + bottomH;
        if (needed <= rulesHeightPx || lhMult <= MIN_LINE_HEIGHT_MULT) break;
        lhMult = Math.max(MIN_LINE_HEIGHT_MULT, lhMult - 0.02);
      }
      const needed = topH + (hasBoth ? minGapPx : 0) + bottomH;
      if (needed <= rulesHeightPx || fontSizePx <= minFontSizePx) break;
      fontSizePx -= 1;
    }

    const sharedSize = fontSizePx / CC_H;
    const gapPx = hasBoth ? Math.max(minGapPx, rulesHeightPx - topH - bottomH) : 0;

    if (topSections.length) {
      await writeText(ctx, card, {
        font: 'mplantin', x: RULES_X, y: RULES_Y, width: RULES_WIDTH, height: (topH * 1.002) / CC_H,
        size: sharedSize, lineHeightMult: lhMult, minLineHeightMult: lhMult, oneLinePerRow: true,
        zebraTint: true, decorX: DECOR_LEFT_X, decorWidth: DECOR_WIDTH, text: topMarkup,
      });
    }
    if (bottomSections.length) {
      const bottomY = RULES_Y + (topH + gapPx) / CC_H;
      if (splitBottom) {
        const bottomTextObj = {
          font: 'mplantin', y: bottomY, width: COLUMN_WIDTH, height: (bottomH * 1.002) / CC_H,
          size: sharedSize, lineHeightMult: lhMult, minLineHeightMult: lhMult, oneLinePerRow: true, zebraTint: true,
        };
        await writeText(ctx, card, {
          ...bottomTextObj, x: RULES_X, decorX: DECOR_LEFT_X, decorWidth: LEFT_COLUMN_DECOR_WIDTH, text: leftMarkup,
        });
        await writeText(ctx, card, {
          ...bottomTextObj, x: RULES_X + COLUMN_WIDTH + COLUMN_GAP, text: rightMarkup,
        });
      } else {
        await writeText(ctx, card, {
          font: 'mplantin', x: RULES_X, y: bottomY, width: RULES_WIDTH, height: (bottomH * 1.002) / CC_H,
          size: sharedSize, lineHeightMult: lhMult, minLineHeightMult: lhMult, oneLinePerRow: true,
          zebraTint: true, decorX: DECOR_LEFT_X, decorWidth: DECOR_WIDTH, text: bottomMarkup,
        });
      }
    }
    if (hasBoth) {
      const dividerY = RULES_Y + (topH + gapPx / 2) / CC_H;
      drawSectionDivider(ctx, card, DECOR_LEFT_X, dividerY, DECOR_WIDTH);
    }

    // 6. Rounded corners
    cutRoundedCorners(ctx, CC_W, CC_H);
  },
};

// Self-register
register(m152col);
export default m152col;
