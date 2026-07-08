// ── SHARED TEXT MARKUP BUILDER ────────────────────────────────────────────────
// Converts the style-agnostic model.sections into the Card Conjurer token string
// consumed by writeText. Shared by the m15 and art-bg renderers (the only place
// CC markup is generated for them).

export function buildTextMarkup(model) {
  const lines = [];
  for (const section of model.sections) {
    lines.push(`{bold}${section.type} (${section.total}){/bold}`);
    for (const row of section.rows) {
      // {rightN}: absolute tab-stop at N×fontSize/100 px from text-box left.
      // Diamond always at {right130}; count prefix sits at {right5}. Shared
      // tab-stop keeps every row's diamond in one aligned column regardless
      // of whether it has a count prefix.
      const prefix = row.count > 1 ? `{right5}${row.count}x{right130}` : `{right130}`;
      lines.push(`${prefix}{fontcolor${row.rarityHex}}◆ {fontcolor#000000}${row.name} ${row.cost}`);
    }
  }
  return lines.join('\\n');
}
