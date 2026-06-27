// ── ACTIVE CARD STATE ────────────────────────────────────────────────────────
// Replaces DOM-stashed state (downloadBtn._decks, cell._meta).
// Each entry: { deck, wmKey, styleKey, artOverride, model, cell }

const _entries = [];

export function clear() { _entries.length = 0; }

export function push(entry) { _entries.push(entry); }

export function get(index) { return _entries[index] ?? null; }

export function update(index, patch) {
  if (_entries[index]) Object.assign(_entries[index], patch);
}

export function getAll() { return _entries; }
