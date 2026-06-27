// ── CUBECOBRA FETCH, CACHE, PARSE + MANUAL DECK FORMAT ──────────────────────

import {
  WUBRG, TYPE_ORDER, RARITY_ORDER,
  IGNORED_TAGS_SET, IGNORED_TAG_RE,
} from './config.js';

// ── NORMALIZE RARITY ─────────────────────────────────────────────────────────

export function normalizeRarity(r) {
  if (r === 'basic') return 'common';
  return RARITY_ORDER.includes(r) ? r : 'common';
}

// ── CUBE ID EXTRACTION ───────────────────────────────────────────────────────

export function extractCubeId(input) {
  try {
    const u = new URL(input);
    if (u.hostname.includes('cubecobra.com')) {
      const parts = u.pathname.split('/').filter(Boolean);
      return parts[parts.length - 1];
    }
  } catch {}
  return input;
}

// ── LOCAL CACHE (24 h TTL) ───────────────────────────────────────────────────

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function cacheGet(cubeId) {
  try {
    const raw = localStorage.getItem(`cube:${cubeId}`);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL_MS) { localStorage.removeItem(`cube:${cubeId}`); return null; }
    return data;
  } catch { return null; }
}

export function cacheSet(cubeId, data) {
  try { localStorage.setItem(`cube:${cubeId}`, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

export function listCachedIds() {
  const ids = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith('cube:')) ids.push(key.slice(5));
  }
  return ids.sort();
}

// ── FETCH ────────────────────────────────────────────────────────────────────

export async function fetchCubeData(cubeId) {
  const cached = cacheGet(cubeId);
  if (cached) return cached;
  const url = `https://cubecobra.com/cube/api/cubeJSON/${encodeURIComponent(cubeId)}`;
  let res;
  try { res = await fetch(url); }
  catch { res = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`); }
  if (!res.ok) throw new Error(`Cubecobra returned HTTP ${res.status}`);
  const data = await res.json();
  cacheSet(cubeId, data);
  return data;
}

// ── MANA SYMBOL HELPERS ──────────────────────────────────────────────────────

// Sort key: X/Y/Z → generic numbers → 2/color hybrid → two-color hybrid →
// phyrexian → mono-colored WUBRG → colorless
export function manaSortKey(sym) {
  const s = sym.toLowerCase().replace(/-/g, '');
  if (s === 'x') return 0;
  if (s === 'y') return 1;
  if (s === 'z') return 2;
  if (/^\d+$/.test(s)) return 10 + parseInt(s, 10);   // generic: 0–20 → 10–30
  if (/^\d[wubrg]$/.test(s)) return 40;               // 2/color hybrid
  if (/^[wubrg]{2}$/.test(s)) return 45;              // two-color hybrid
  if (/^[wubrgc]p$/.test(s)) return 55;               // phyrexian
  const colorOrder = { w: 60, u: 61, b: 62, r: 63, g: 64, c: 65 };
  return colorOrder[s] ?? 99;
}

export function formatCost(parsedCost) {
  if (!Array.isArray(parsedCost) || parsedCost.length === 0) return '';
  return [...parsedCost]
    .sort((a, b) => manaSortKey(a) - manaSortKey(b))
    .map(c => `{${c.replace(/-/g, '')}}`)
    .join('');
}

export function simplifyType(typeStr) {
  if (!typeStr) return 'Other';
  const base = typeStr.split(' — ')[0].replace(/^Legendary /, '').replace(/^Basic /, '');
  if (base === 'Card') return 'Other';
  if (base.includes('Token')) return 'Token';
  if (base.includes('Creature')) return 'Creature';
  if (base.includes('Enchantment')) return 'Artifact';
  return base;
}

// ── CUBECOBRA PARSE ──────────────────────────────────────────────────────────

export function parseDecks(data) {
  const mainboard = data?.cards?.mainboard ?? [];
  const seen = new Set(), unique = [];
  for (const item of mainboard) {
    if (!seen.has(item.index)) { seen.add(item.index); unique.push(item); }
  }
  const byTag = {};
  for (const item of unique) {
    for (const tag of (item.tags ?? [])) {
      if (IGNORED_TAGS_SET.has(tag) || IGNORED_TAG_RE.test(tag)) continue;
      (byTag[tag] ??= []).push(item);
    }
  }
  return Object.entries(byTag).map(([name, items]) => ({
    name,
    cards: items.map(item => {
      const d       = item.details ?? {};
      const typeStr = d.type ?? '';
      const isBasic = /\bBasic\b/i.test(typeStr);
      return {
        name:   d.name   ?? '',
        rarity: isBasic ? 'common' : normalizeRarity(d.rarity),
        type:   simplifyType(typeStr),
        cost:   formatCost(d.parsed_cost),
        colors: d.colors ?? [],
        art:    d.art_crop ?? d.image_normal ?? null,   // for art-background style
      };
    }),
  }));
}

// ── COLORS FROM COST ───────────────────────────────────────────────────────────
// Infer WUBRG color identity from a cost string's mana symbols (e.g. "{g}{w}").

export function colorsFromCost(costRaw) {
  const colors = [];
  const colorSym = { w: 'W', u: 'U', b: 'B', r: 'R', g: 'G' };
  for (const sym of (costRaw.match(/\{([^}]+)\}/g) ?? [])) {
    const parts = sym.slice(1, -1).toLowerCase().replace(/-/g, '').split('/');
    for (const p of parts) {
      if (colorSym[p] && !colors.includes(colorSym[p])) colors.push(colorSym[p]);
    }
  }
  return colors.sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b));
}

// ── MANUAL DECK PARSER ───────────────────────────────────────────────────────
// Format:
//   # Deck Name
//   Creature
//   4 Llanowar Elves {g}
//   1 Wrath of God {2}{w}{w} (rare)
//   Land
//   6 Forest

export function parseManualDeck(text) {
  const decks = [];
  let currentDeck = null;
  let currentType = 'Other';

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#')) {
      const name = line.slice(1).trim() || 'Deck';
      currentDeck = { name, cards: [] };
      decks.push(currentDeck);
      currentType = 'Other';
      continue;
    }

    if (!currentDeck) {
      currentDeck = { name: 'Manual Deck', cards: [] };
      decks.push(currentDeck);
    }

    if (/^\d/.test(line)) {
      const m = line.match(/^(\d+)\s+(.+?)(?:\s+((?:\{[^}]+\}\s*)+))?(?:\s*\(([^)]+)\))?\s*$/);
      if (m) {
        const count   = parseInt(m[1], 10);
        const name    = m[2].trim();
        const costRaw = (m[3] ?? '').trim();
        const rarity  = normalizeRarity((m[4] ?? '').toLowerCase());

        const colors = colorsFromCost(costRaw);

        const cost = costRaw.replace(/\s+/g, '');

        for (let i = 0; i < count; i++) {
          currentDeck.cards.push({ name, type: currentType, rarity, cost, colors });
        }
      }
      continue;
    }

    // Type header
    currentType = line.replace(/\s*\(\d+\)$/, '').trim();
  }

  return decks.filter(d => d.cards.length > 0);
}

// ── DECK → MANUAL TEXT (for edit modal) ─────────────────────────────────────

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

export function deckToManualText(deck) {
  const lines = [`# ${deck.name}`];
  const typeGroups = groupByType(deck.cards);
  const sortedTypes = Object.keys(typeGroups).sort((a, b) => {
    const ai = TYPE_ORDER.indexOf(a), bi = TYPE_ORDER.indexOf(b);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  for (const type of sortedTypes) {
    if (type === 'Other') continue;
    lines.push(type);
    for (const { card, count } of groupDuplicates(typeGroups[type])) {
      const cost   = card.cost ? ` ${card.cost}` : '';
      const rarity = card.rarity !== 'common' ? ` (${card.rarity})` : '';
      lines.push(`${count} ${card.name}${cost}${rarity}`);
    }
  }
  return lines.join('\n');
}

// ── DECK YAML (D1: export / import) ─────────────────────────────────────────
// A small, self-contained YAML subset — we own both ends, so no parser library.
// Cards are stored compactly (count + fields); duplicates expand on import.

function sortTypes(types) {
  return [...types].sort((a, b) => {
    const ai = TYPE_ORDER.indexOf(a), bi = TYPE_ORDER.indexOf(b);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
}

function yamlQuote(s) {
  return `"${String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function yamlUnquote(v) {
  v = v.trim();
  if (v.length >= 2 &&
      ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
    return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return v;
}

export function decksToYaml(decks) {
  const lines = ['# Decklist export', 'decks:'];
  for (const deck of decks) {
    lines.push(`  - name: ${yamlQuote(deck.name)}`);
    lines.push('    cards:');
    const typeGroups = groupByType(deck.cards);
    for (const type of sortTypes(Object.keys(typeGroups))) {
      if (type === 'Other') continue;
      for (const { card, count } of groupDuplicates(typeGroups[type])) {
        lines.push(`      - count: ${count}`);
        lines.push(`        name: ${yamlQuote(card.name)}`);
        lines.push(`        type: ${yamlQuote(card.type)}`);
        lines.push(`        rarity: ${yamlQuote(card.rarity)}`);
        lines.push(`        cost: ${yamlQuote(card.cost)}`);
        lines.push(`        colors: ${yamlQuote((card.colors ?? []).join(''))}`);
      }
    }
  }
  return lines.join('\n') + '\n';
}

export function parseDeckYaml(text) {
  const decks = [];
  let deck = null, card = null;

  const flush = () => {
    if (!deck || !card) { card = null; return; }
    let colors = (card.colors ?? '').toUpperCase().split('').filter(c => WUBRG.includes(c));
    if (colors.length === 0 && card.cost) colors = colorsFromCost(card.cost);
    const base = {
      name:   card.name ?? '',
      type:   card.type || 'Other',
      rarity: normalizeRarity((card.rarity ?? '').toLowerCase()),
      cost:   (card.cost ?? '').replace(/\s+/g, ''),
    };
    const n = Math.max(1, parseInt(card.count, 10) || 1);
    for (let i = 0; i < n; i++) deck.cards.push({ ...base, colors: [...colors] });
    card = null;
  };

  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    let line = raw.trim();
    const isItem = line.startsWith('-');
    if (isItem) line = line.replace(/^-\s*/, '');

    const m = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2];

    if (key === 'decks' || key === 'cards') continue;

    // Deck items are `- name:` at shallow indent; card items are `- count:`.
    if (key === 'name' && isItem && indent <= 3) {
      flush();
      deck = { name: yamlUnquote(val) || 'Deck', cards: [] };
      decks.push(deck);
      continue;
    }
    if (key === 'count') {
      flush();
      card = { count: yamlUnquote(val) };
      continue;
    }
    if (card && ['name', 'type', 'rarity', 'cost', 'colors'].includes(key)) {
      card[key] = yamlUnquote(val);
      continue;
    }
    if (!card && deck && key === 'name') deck.name = yamlUnquote(val);
  }
  flush();
  return decks.filter(d => d.cards.length > 0);
}

// ── SCRYFALL ART SEARCH ───────────────────────────────────────────────────────
// Search Scryfall by card name; returns up to 20 unique artworks.
// Used by the "Search Scryfall" tab in the edit modal art picker.

export async function searchScryfallArt(query) {
  if (!query || query.length < 2) return [];
  try {
    const r = await fetch(
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=art&order=released`,
    );
    if (!r.ok) return [];
    const d = await r.json();
    return (d.data ?? [])
      .filter(c => c.image_uris?.art_crop)
      .map(c => ({ name: c.name, artUrl: c.image_uris.art_crop }))
      .slice(0, 20);
  } catch { return []; }
}

// ── SCRYFALL ART URL RESOLUTION ───────────────────────────────────────────────
// If `input` is a Scryfall card page URL (scryfall.com/card/{set}/{num}[/…]),
// fetch the card via the API and return the art_crop image URL.
// Any other URL (or plain image URL) is returned unchanged.
// Results are cached so repeated renders don't repeat the fetch.

const _artResolveCache = new Map();

export async function resolveArtUrl(input) {
  if (!input) return '';
  const url = input.trim();
  if (_artResolveCache.has(url)) return _artResolveCache.get(url);

  const m = url.match(/^https?:\/\/scryfall\.com\/card\/([^\/\?#]+)\/([^\/\?#]+)/);
  if (m) {
    try {
      const r = await fetch(`https://api.scryfall.com/cards/${m[1]}/${m[2]}`);
      if (r.ok) {
        const d = await r.json();
        const uris = d.image_uris ?? d.card_faces?.[0]?.image_uris;
        const resolved = uris?.art_crop ?? url;
        _artResolveCache.set(url, resolved);   // cache only a successful resolve
        return resolved;
      }
    } catch { /* network error — fall through */ }
    // Fetch failed or returned non-OK: return the raw URL but DON'T cache it,
    // so a later retry can resolve it instead of being stuck on the fallback.
    return url;
  }

  // Non-Scryfall input is already final — safe to cache the passthrough.
  _artResolveCache.set(url, url);
  return url;
}
