// ── SHARED TEXT HELPERS ──────────────────────────────────────────────────────

// "Title | Subtitle" convention (cover style deck names, inline/batch title
// editors). Single source of truth so the split/trim logic can't drift
// between call sites.
export function splitTitleSubtitle(name) {
  const parts = (name ?? '').split('|');
  return { title: parts[0].trim(), subtitle: parts.slice(1).join('|').trim() };
}

// Inverse of splitTitleSubtitle: rebuild a "Title | Subtitle" deck name (or
// just the title when there's no subtitle).
export function mergeTitleSubtitle(title, subtitle) {
  return subtitle ? `${title} | ${subtitle}` : title;
}
