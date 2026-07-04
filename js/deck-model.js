// ── STYLE-AGNOSTIC DECK MODEL ────────────────────────────────────────────────
// buildDeckModel returns a plain data object with NO renderer-specific fields:
// no coords, no font names, no CC markup tokens.

import { WUBRG, RARITY_ORDER, RARITY_HEX } from './config.js?v=2';
import { resolveWatermark } from './watermarks.js?v=3';
import { splitTitleSubtitle } from './text-utils.js?v=2';
import { groupByType, groupDuplicates, sortTypes } from './card-utils.js?v=1';

// ── PRIVATE HELPERS ──────────────────────────────────────────────────────────

function collectManaCodes(deck) {
  const codes = new Set();
  for (const card of deck.cards) {
    const tokens = (card.cost.match(/\{([^}]+)\}/g) ?? [])
      .map(t => t.slice(1, -1).replace(/[-\/]/g, '').toLowerCase());
    for (const t of tokens) codes.add(t);
  }
  return [...codes];
}

// ── EXPORTED HELPERS ─────────────────────────────────────────────────────────

export function deckColors(deck) {
  const counts = {};
  for (const card of deck.cards) {
    if (card.type === 'Token') continue;
    for (const c of card.colors) counts[c] = (counts[c] ?? 0) + 1;
  }
  return counts;
}

// Primary = most common color (by card count), secondary = second most.
// Returns { primary: 'W'|'U'|…|'M'|'C', secondary: same }
export function primarySecondary(deck) {
  // Tie-break by WUBRG order (not card-list order) so reordering the deck's
  // card lines can't flip which equally-common color is "primary".
  const sorted = Object.entries(deckColors(deck)).sort((a, b) =>
    b[1] - a[1] || WUBRG.indexOf(a[0]) - WUBRG.indexOf(b[0]));
  if (sorted.length === 0) return { primary: 'C', secondary: 'C' };
  if (sorted.length === 1) return { primary: sorted[0][0], secondary: sorted[0][0] };
  if (sorted.length === 2) return { primary: sorted[0][0], secondary: sorted[1][0] };
  return { primary: 'M', secondary: 'M' };
}

// Color identity: WUBRG-sorted list of colors present across non-token cards.
// Fallback ['C'] for colorless/lands-only decks.
export function deckColorIdentity(deck) {
  const seen = new Set();
  for (const card of deck.cards) {
    if (card.type === 'Token') continue;
    for (const c of card.colors) seen.add(c);
  }
  const filtered = WUBRG.filter(c => seen.has(c));
  return filtered.length ? filtered : ['C'];
}

// Background art for the art-background style: the art of the deck's
// highest-rarity non-token card. Returns null when no card carries art.
export function deckArtUrl(deck) {
  let best = null, bestRank = -1;
  for (const card of deck.cards) {
    if (card.type === 'Token' || !card.art) continue;
    const rank = RARITY_ORDER.indexOf(card.rarity);
    if (rank > bestRank) { bestRank = rank; best = card.art; }
  }
  return best;
}

// ── BUILD MODEL ──────────────────────────────────────────────────────────────

// Derive { primary, secondary } from an explicit WUBRG-sorted color list, the
// same way primarySecondary derives them from pip counts:
//   length 1 → primary=secondary=that color
//   length 2 → primary=first, secondary=second
//   length ≥3 → primary=secondary='M'
//   ['C']    → 'C'
function primarySecondaryFromColors(colors) {
  if (colors.length === 1) return { primary: colors[0], secondary: colors[0] };
  if (colors.length === 2) return { primary: colors[0], secondary: colors[1] };
  return { primary: 'M', secondary: 'M' };
}

export function buildDeckModel(deck, wmKey, artOverride, opts = {}) {
  const override = Array.isArray(opts.colorOverride) && opts.colorOverride.length
    ? opts.colorOverride
    : null;

  let primary, secondary, colorIdent;
  if (override) {
    // ['C'] is allowed and stays as-is; otherwise WUBRG-sort the override.
    colorIdent = override.includes('C') ? ['C'] : WUBRG.filter(c => override.includes(c));
    if (!colorIdent.length) colorIdent = ['C'];
    ({ primary, secondary } = primarySecondaryFromColors(colorIdent));
  } else {
    ({ primary, secondary } = primarySecondary(deck));
    colorIdent = deckColorIdentity(deck);
  }

  // Fraction of the frame/watermark width given to the PRIMARY (dominant) color,
  // by pip count. Only meaningful for two-color decks (mono/3+ collapse to one
  // frame). Clamped so the secondary "splash" always stays visible.
  let splitRatio = 0.5;
  if (primary !== secondary && !override) {
    const counts = deckColors(deck);
    const a = counts[primary] ?? 0, b = counts[secondary] ?? 0;
    if (a + b > 0) splitRatio = Math.max(0.5, Math.min(0.85, a / (a + b)));
  }

  // Manual blend override (Unit 5 slider): replaces the auto pip-count ratio.
  // Full 0–1 range so the user can push the split all the way either direction.
  if (opts.blendRatio != null) {
    splitRatio = Math.max(0, Math.min(1, opts.blendRatio));
  }

  // Build sections (type groups ordered by TYPE_ORDER, 'Other' excluded)
  const typeGroups  = groupByType(deck.cards);
  const sortedTypes = sortTypes(Object.keys(typeGroups));

  const sections = [];
  for (const type of sortedTypes) {
    if (type === 'Other') continue;
    const dupes = groupDuplicates(typeGroups[type]);
    sections.push({
      type,
      total: typeGroups[type].length,
      rows: dupes.map(({ card, count }) => ({
        count,
        name:      card.name,
        cost:      card.cost,
        rarity:    card.rarity,
        rarityHex: RARITY_HEX[card.rarity] ?? '#000000',
      })),
    });
  }

  // "Title | Subtitle" → split for the cover style; other styles use `name` only.
  const { title, subtitle } = splitTitleSubtitle(deck.name);

  return {
    name:           title,
    subtitle,                         // cover-card tagline (empty unless name has a "| …")
    colorIdentity:  colorIdent,       // WUBRG-sorted; used for color-pip icons + set-color wm lookup
    primaryColor:   primary,          // most common color; drives frame + wm tint left
    secondaryColor: secondary,        // second color; drives frame split + wm tint right
    watermark:      resolveWatermark(wmKey, colorIdent, primary, secondary),
    splitRatio,                       // primary-color width fraction (left side)
    artUrl:         (artOverride && artOverride.trim()) || deckArtUrl(deck),  // art-background style
    artTransform:   opts.artTransform ?? { x: 0, y: 0, zoom: 1 },  // pan/zoom for the art box
    sections,
    manaCodes:      collectManaCodes(deck),
  };
}
