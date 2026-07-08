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
      // Single-copy rows tab the diamond in from the left margin at {right95}.
      // Multi-copy rows flow the diamond right after the "Nx " count prefix
      // instead of a fixed tab-stop, so a wide (2-digit+) count never collides
      // with it.
      const prefix = row.count > 1 ? `{right5}${row.count}x ` : `{right95}`;
      lines.push(`${prefix}{fontcolor${row.rarityHex}}◆ {fontcolor#000000}${row.name} ${row.cost}`);
    }
  }
  return lines.join('\\n');
}
