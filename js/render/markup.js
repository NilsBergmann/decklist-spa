// ── SHARED TEXT MARKUP BUILDER ────────────────────────────────────────────────
// Converts the style-agnostic model.sections into the Card Conjurer token string
// consumed by writeText. Shared by the m15 and art-bg renderers (the only place
// CC markup is generated for them).

// Builds markup for an explicit list of sections (a subset for a column, or
// the full model.sections for a single-column layout). showBullet: false
// omits the rarity-diamond bullet entirely — useful for Land/Token sections,
// where rarity isn't meaningful info worth flagging.
export function buildSectionsMarkup(sections, { showBullet = true } = {}) {
  const lines = [];
  for (const section of sections) {
    lines.push(`{bold}${section.type} (${section.total}){/bold}`);
    for (const row of section.rows) {
      // {rightN}: absolute tab-stop at N×fontSize/100 px from text-box left.
      // Diamond always at {right130}; count prefix sits at {right5}. Shared
      // tab-stop keeps every row's diamond in one aligned column regardless
      // of whether it has a count prefix.
      const prefix = row.count > 1 ? `{right5}${row.count}x{right130}` : `{right130}`;
      const bullet = showBullet ? `{fontcolor${row.rarityHex}}◆ {fontcolor#000000}` : '';
      lines.push(`${prefix}${bullet}${row.name} ${row.cost}`);
    }
  }
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
