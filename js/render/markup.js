// ── SHARED TEXT MARKUP BUILDER ────────────────────────────────────────────────
// Converts the style-agnostic model.sections into the Card Conjurer token string
// consumed by writeText. Shared by the m15 and art-bg renderers (the only place
// CC markup is generated for them).

// Section headings always read as a plural category name ("Creatures",
// "Lands"), regardless of card count — TYPE_ORDER's singular bucket names
// stay singular (grouping/sorting/YAML/manual-text round-trip all key off
// them unchanged), this only affects the printed heading text.
const PLURAL_TYPE_LABELS = {
  Creature: 'Creatures', Land: 'Lands', Token: 'Tokens', Planeswalker: 'Planeswalkers',
};

function pluralizeTypeLabel(type) {
  if (PLURAL_TYPE_LABELS[type]) return PLURAL_TYPE_LABELS[type];
  if (type.includes('&') || type.endsWith('s')) return type;   // already plural / compound
  return `${type}s`;
}

// Builds markup for an explicit list of sections (a subset for a column, or
// the full model.sections for a single-column layout). showBullet: false
// omits the rarity-diamond bullet AND its tab-stop indentation entirely —
// useful for Land/Token sections, where rarity isn't meaningful info worth
// flagging and there's no bullet to align a name column against. tabStop
// scales the diamond's/count-prefix's {rightN} indent (default 130, same as
// the original Card Conjurer template) — the 2-column style halves this
// since its narrower columns don't need as much indent to look right.
// Below this, a full-size "Nx" count prefix (roughly 1.05×fontSize wide,
// even for a single digit) no longer reliably fits ahead of the diamond's
// own tab-stop — the 2-column style's halved tabStop (65) is well under
// this, the default (130) sits comfortably above it.
const COMPACT_COUNT_THRESHOLD = 100;
const COUNT_SIZE_PCT = 80;   // shrink the count digits a bit for a tight tab-stop; {rjust} lets them
                              // overflow past the box's left edge instead of shrinking further to fit
const COUNT_GAP      = 8;    // gap (same N-units as tabStop) between the count's right edge and the diamond

export function buildSectionsMarkup(sections, { showBullet = true, tabStop = 130 } = {}) {
  const lines = [];
  const countTabStop = Math.round(tabStop / 26);   // scales with tabStop; 5 at the default 130
  const compactCount = tabStop < COMPACT_COUNT_THRESHOLD;
  sections.forEach((section, i) => {
    // {divider}: a light rule + gap before every heading except the very
    // first in this call's list (so a column/block never opens with one).
    // {header}: marks the heading line so row-zebra-tinting (text.js) skips
    // it and doesn't count it toward the alternation.
    if (i > 0) lines.push('{divider}');
    lines.push(`{header}{bold}${pluralizeTypeLabel(section.type)} (${section.total}){/bold}`);
    // Tokens aren't cast, so a mana cost carried over from the card that
    // creates them isn't meaningful info — omit it entirely for Token rows.
    const showCost = section.type !== 'Token';
    for (const row of section.rows) {
      const costSuffix = showCost && row.cost ? ` ${row.cost}` : '';
      if (!showBullet) {
        const countPrefix = row.count > 1 ? `${row.count} ` : '';
        lines.push(`${countPrefix}${row.name}${costSuffix}`);
        continue;
      }
      // {rightN}: absolute tab-stop at N×fontSize/100 px from text-box left.
      // Diamond always at {right<tabStop>}; count prefix sits at a
      // proportionally smaller stop. Shared tab-stop keeps every row's
      // diamond in one aligned column regardless of whether it has a count
      // prefix. {diamond} renders at a fixed size (the block's base font
      // size) instead of scaling with the row's own text, so a shrunk long
      // name's diamond still matches every other row's — see text.js.
      // When tabStop is too tight for a full-size "Nx" prefix to fit ahead
      // of it (compactCount), shrink the count and right-justify it so its
      // edge always lands just before the diamond, however many digits it
      // has — instead of a fixed left tab-stop that can run past the diamond
      // entirely and knock it out of alignment.
      let prefix;
      if (row.count > 1) {
        prefix = compactCount
          ? `{size${COUNT_SIZE_PCT}}{rjust${tabStop - COUNT_GAP}}${row.count}{size100}{right${tabStop}}`
          : `{right${countTabStop}}${row.count}{right${tabStop}}`;
      } else {
        prefix = `{right${tabStop}}`;
      }
      lines.push(`${prefix}{fontcolor${row.rarityHex}}{diamond} {fontcolor#000000}${row.name}${costSuffix}`);
    }
  });
  return lines.join('\\n');
}

export function buildTextMarkup(model) {
  return buildSectionsMarkup(model.sections);
}

// Splits sections into two column groups of roughly equal weight (header +
// row count per section), without breaking a section across columns.
// Greedy: walk sections in order, drop each whole section into whichever
// column currently has the smaller running weight.
export function splitSectionsIntoColumns(sections) {
  const left = [], right = [];
  let leftWeight = 0, rightWeight = 0;
  for (const section of sections) {
    const weight = 1 + section.rows.length;
    if (leftWeight <= rightWeight) { left.push(section); leftWeight += weight; }
    else                           { right.push(section); rightWeight += weight; }
  }
  return [left, right];
}
