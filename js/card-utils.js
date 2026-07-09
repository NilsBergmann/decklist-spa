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

// A cost token contributes a "mono" color pip only when it's a single bare
// WUBRG letter ("w"). Every other colored form — guild hybrid ("wu"/"w/u"),
// 2-generic hybrid ("2w"/"2/w"), Phyrexian ("wp"/"w/p") — is hybrid mana,
// payable without ever tapping that color.
function isMonoColorToken(raw) {
  const t = raw.toLowerCase().replace(/[-/]/g, '');
  return t.length === 1 && 'wubrg'.includes(t);
}

// A "pure hybrid" card has at least one color but every colored pip in its
// cost is a hybrid symbol — no bare mono-colored pip anywhere. Such a card
// can be cast without ever paying its off-colors, so it shouldn't pull deck
// coloration toward them (e.g. a white deck splashing a lone {G/W} card
// should still read as mono-white, not W/G).
export function isPureHybridCard(card) {
  if (!card.colors || card.colors.length === 0) return false;
  const tokens = (card.cost.match(/\{([^}]+)\}/g) ?? []).map(t => t.slice(1, -1));
  return !tokens.some(isMonoColorToken);
}
