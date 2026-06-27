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
  'Planeswalker', 'Creature', 'Instant', 'Sorcery',
  'Artifact', 'Land', 'Token',
];

export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'mythic'];

// A1: Z Token fix — extended set + forward-proof /^[YZ]\s/ guard
export const IGNORED_TAGS_SET = new Set(['Token', 'Y Token', 'Z Theme', 'Z Token']);
export const IGNORED_TAG_RE   = /^[YZ]\s/;

// WUBRG-sorted two-color pair → available hybrid mana SVG code.
export const GUILD_HYBRID = {
  WU: 'wu', WB: 'wb', WR: 'rw', WG: 'gw', UB: 'ub',
  UR: 'ur', UG: 'gu', BR: 'br', BG: 'bg', RG: 'rg',
};
