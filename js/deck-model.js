// ── STYLE-AGNOSTIC DECK MODEL ────────────────────────────────────────────────
// buildDeckModel returns a plain data object with NO renderer-specific fields:
// no coords, no font names, no CC markup tokens.

import { WUBRG, TYPE_ORDER, RARITY_ORDER, RARITY_HEX } from './config.js';
import { resolveWatermark } from './watermarks.js?v=2';

// ── PRIVATE HELPERS ──────────────────────────────────────────────────────────

function groupByType(cards) {
  const g = {};
  for (const c of cards) (g[c.type] ??= []).push(c);
  return g;
}

function groupDuplicates(cards) {
  const map = {};
  for (const c of cards) {
    if (map[c.name]) map[c.name].count++;
    else map[c.name] = { card: c, count: 1 };
  }
  return Object.values(map).sort(
    (a, b) => RARITY_ORDER.indexOf(a.card.rarity) - RARITY_ORDER.indexOf(b.card.rarity),
  );
}

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
  const sorted = Object.entries(deckColors(deck)).sort((a, b) => b[1] - a[1]);
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

  // Build sections (type groups ordered by TYPE_ORDER, 'Other' excluded)
  const typeGroups  = groupByType(deck.cards);
  const sortedTypes = Object.keys(typeGroups).sort((a, b) => {
    const ai = TYPE_ORDER.indexOf(a), bi = TYPE_ORDER.indexOf(b);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });

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
  const [rawTitle, ...rest] = deck.name.split('|');
  const title    = rawTitle.trim();
  const subtitle = rest.join('|').trim();

  return {
    name:           title,
    subtitle,                         // cover-card tagline (empty unless name has a "| …")
    colorIdentity:  colorIdent,       // WUBRG-sorted; used for color-pip icons + set-color wm lookup
    primaryColor:   primary,          // most common color; drives frame + wm tint left
    secondaryColor: secondary,        // second color; drives frame split + wm tint right
    watermark:      resolveWatermark(wmKey, colorIdent, primary, secondary),
    splitRatio,                       // primary-color width fraction (left side)
    artUrl:         (artOverride && artOverride.trim()) || deckArtUrl(deck),  // art-background style
    sections,
    manaCodes:      collectManaCodes(deck),
  };
}
