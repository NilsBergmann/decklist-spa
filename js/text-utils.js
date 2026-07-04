// ── SHARED TEXT HELPERS ──────────────────────────────────────────────────────

// "Title | Subtitle" convention (cover style deck names, inline/batch title
// editors). Single source of truth so the split/trim logic can't drift
// between call sites.
export function splitTitleSubtitle(name) {
  const parts = (name ?? '').split('|');
  return { title: parts[0].trim(), subtitle: parts.slice(1).join('|').trim() };
}
