// ── SHARED CONSTANTS ────────────────────────────────────────────────────────

export const COLOR_HEX = {
  W: '#b79d58', U: '#5e98d9', B: '#5e5e5e',
  R: '#d16e5e', G: '#5e9e5e', C: '#9e9e9e', M: '#cab34d',
};

export const RARITY_HEX = {
  common: '#000000', uncommon: '#707883', rare: '#a58e4a', mythic: '#bf4427',
};

export const WUBRG = ['W', 'U', 'B', 'R', 'G'];

export const TYPE_ORDER = [
  'Planeswalker', 'Creature', 'Instants & Sorceries',
  'Artifacts & Enchantments', 'Land', 'Token',
];

export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'mythic'];

// A1: Z Token fix — extended set + forward-proof /^[XYZ]\s/ guard.
// X/Y/Z-prefixed tags are draft-archetype scratch packs, not real decks; "Other"
// is Cubecobra's catch-all bucket for untagged cards — none should render as a card.
export const IGNORED_TAGS_SET = new Set(['Token', 'Y Token', 'Z Theme', 'Z Token', 'Other']);
export const IGNORED_TAG_RE   = /^[XYZ]\s/;

// WUBRG-sorted two-color pair → available hybrid mana SVG code.
export const GUILD_HYBRID = {
  WU: 'wu', WB: 'wb', WR: 'rw', WG: 'gw', UB: 'ub',
  UR: 'ur', UG: 'gu', BR: 'br', BG: 'bg', RG: 'rg',
};

// Shared style for every light section-divider rule drawn on a printed card
// (the m15/m15-2col top/bottom vfill split in m15-shared.js, and the
// per-heading {divider} rule in render/text.js) — kept in one place so the
// two mechanisms can't drift apart visually.
export const DIVIDER_COLOR = 'rgba(0,0,0,0.18)';
export const DIVIDER_LINE_WIDTH_FRAC = 0.0015;   // fraction of card height
