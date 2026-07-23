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
import { drawColorPips }     from './pips.js?v=1';
import { buildSectionsMarkup, splitSectionsIntoColumns } from './markup.js?v=3';
import { writeText, fitText, scaleWidth, scaleHeight } from './text.js?v=5';
import {
  CC_W, CC_H, frameSrc, drawFrames, drawWatermark,
} from './m15-shared.js?v=3';

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
const BLOCK_GAP     = 0.012;   // vertical gap between the spell block and the land/token block
const MIN_BLOCK_FRAC = 0.15;   // neither block shrinks below this share of RULES_HEIGHT

const RULES_SIZE = 0.0362;   // same base as m15 — starting point for the shared-size search below

// Same leading range for every block (spell block + both land/token columns)
// so a shared font size also means a visually consistent leading, not just
// matching numbers.
const LINE_HEIGHT_MULT     = 1.15;
const MIN_LINE_HEIGHT_MULT = 0.95;

const BOTTOM_TYPES = new Set(['Land', 'Token']);

function sectionWeight(sections) {
  return sections.reduce((sum, s) => sum + 1 + s.rows.length, 0);
}

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
    // split into two columns underneath, each block's height proportional
    // to its section weight (row + header count).
    const topSections    = model.sections.filter(s => !BOTTOM_TYPES.has(s.type));
    const bottomSections = model.sections.filter(s => BOTTOM_TYPES.has(s.type));

    let topFrac, bottomFrac, bottomY;
    if (topSections.length && bottomSections.length) {
      const topWeight = sectionWeight(topSections), bottomWeight = sectionWeight(bottomSections);
      const rawTopFrac = (RULES_HEIGHT - BLOCK_GAP) * topWeight / (topWeight + bottomWeight);
      topFrac = Math.max(MIN_BLOCK_FRAC, Math.min(RULES_HEIGHT - BLOCK_GAP - MIN_BLOCK_FRAC, rawTopFrac));
      bottomFrac = RULES_HEIGHT - BLOCK_GAP - topFrac;
      bottomY = RULES_Y + topFrac + BLOCK_GAP;
    } else if (topSections.length) {
      topFrac = RULES_HEIGHT;
    } else {
      bottomFrac = RULES_HEIGHT;
      bottomY = RULES_Y;
    }

    const blocks = [];
    if (topSections.length) {
      blocks.push({
        x: RULES_X, y: RULES_Y, width: RULES_WIDTH, height: topFrac,
        oneLinePerRow: true, text: buildSectionsMarkup(topSections),
      });
    }
    if (bottomSections.length) {
      const [leftSections, rightSections] = splitSectionsIntoColumns(bottomSections);
      // Land/Token rows skip the rarity-colored diamond — rarity isn't
      // meaningful info for these, unlike real spells.
      blocks.push({ x: RULES_X, y: bottomY, width: COLUMN_WIDTH, height: bottomFrac, oneLinePerRow: false, text: buildSectionsMarkup(leftSections, { showRarity: false }) });
      blocks.push({ x: RULES_X + COLUMN_WIDTH + COLUMN_GAP, y: bottomY, width: COLUMN_WIDTH, height: bottomFrac, oneLinePerRow: false, text: buildSectionsMarkup(rightSections, { showRarity: false }) });
    }

    // Find one font size that fits every block, so text size (and leading)
    // stays consistent across the whole card instead of each block
    // independently shrinking to a different size.
    const baseFontSizePx = Math.round(RULES_SIZE * CC_H);
    const fits = await Promise.all(blocks.map(b => fitText(ctx, b.text, {
      fontFamily: 'mplantin', fontSize: baseFontSizePx,
      maxWidth: scaleWidth(b.width, card), boxHeight: scaleHeight(b.height, card),
      lineHeightMult: LINE_HEIGHT_MULT, minLineHeightMult: MIN_LINE_HEIGHT_MULT,
      oneLinePerRow: b.oneLinePerRow,
    })));
    const sharedSize = fits.length ? Math.min(...fits.map(f => f.fontSize)) / CC_H : RULES_SIZE;

    for (const b of blocks) {
      await writeText(ctx, card, {
        font: 'mplantin', x: b.x, y: b.y, width: b.width, height: b.height, size: sharedSize,
        lineHeightMult: LINE_HEIGHT_MULT, minLineHeightMult: MIN_LINE_HEIGHT_MULT,
        oneLinePerRow: b.oneLinePerRow, text: b.text,
      });
    }

    // 6. Rounded corners
    cutRoundedCorners(ctx, CC_W, CC_H);
  },
};

// Self-register
register(m152col);
export default m152col;
