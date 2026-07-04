// ── SHARED CARD GROUPING/SORTING HELPERS ─────────────────────────────────────
// Used by both the render path (deck-model.js) and the edit-modal/YAML text
// paths (cube-source.js), so a fix here reaches every caller.

import { TYPE_ORDER, RARITY_ORDER } from './config.js?v=2';

export function groupByType(cards) {
  const g = {};
  for (const c of cards) (g[c.type] ??= []).push(c);
  return g;
}

export function groupDuplicates(cards) {
  const map = {};
  for (const c of cards) {
    if (map[c.name]) map[c.name].count++;
    else map[c.name] = { card: c, count: 1 };
  }
  return Object.values(map).sort(
    (a, b) => RARITY_ORDER.indexOf(a.card.rarity) - RARITY_ORDER.indexOf(b.card.rarity),
  );
}

// Sorts type names by TYPE_ORDER; unrecognized types (e.g. "Other") sort last.
export function typeOrderCompare(a, b) {
  const ai = TYPE_ORDER.indexOf(a), bi = TYPE_ORDER.indexOf(b);
  return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
}

export function sortTypes(types) {
  return [...types].sort(typeOrderCompare);
}
