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

// Move the entry at `from` to position `to` (used by drag-to-reorder).
export function move(from, to) {
  if (from === to || from < 0 || to < 0 ||
      from >= _entries.length || to >= _entries.length) return;
  const [moved] = _entries.splice(from, 1);
  _entries.splice(to, 0, moved);
}

// Current index of a cell's entry (handlers resolve this live so positional
// indices stay correct after a reorder).
export function indexOfCell(cell) {
  return _entries.findIndex(e => e.cell === cell);
}
