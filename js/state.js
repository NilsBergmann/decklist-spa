// ── ACTIVE CARD STATE ────────────────────────────────────────────────────────
// Replaces DOM-stashed state (downloadBtn._decks, cell._meta).
// Each entry: { deck, wmKey, styleKey, artOverride, colorOverride, blendRatio,
//               artTransform, model, cell }
//   colorOverride: null = auto; else WUBRG letters (or ['C']) for the pack colors.
//   blendRatio:    null = auto (pip-count split); 0.5–0.9 = manual blend slider.
//   artTransform:  { x, y, zoom } pan/zoom for the art box (default {0,0,1}).

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
