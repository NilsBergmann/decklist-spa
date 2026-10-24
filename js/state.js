// ── ACTIVE CARD STATE ────────────────────────────────────────────────────────
// Replaces DOM-stashed state (downloadBtn._decks, cell._meta).
// Each entry: { deck, wmKey, styleKey, artOverride, colorOverride, blendRatio,
//               artTransform, autoSort, model, cell }
//   colorOverride: null = auto; else WUBRG letters (or ['C']) for the pack colors.
//   blendRatio:    null = auto (pip-count split); 0.5–0.9 = manual blend slider.
//   artTransform:  { x, y, zoom } pan/zoom for the art box (default {0,0,1}).
//   autoSort:      true (default) = each section auto-sorts by rarity/land-token
//                  rule; false = the deck's own card order wins (edit-modal drag).

const _entries = [];

// Fires after every mutation below (clear/push/update/move) — session.js uses
// this to debounce an auto-save, without every call site here needing to
// remember to trigger one itself.
let _onChange = null;
export function setChangeListener(fn) { _onChange = fn; }
function notify() { if (_onChange) _onChange(); }

export function clear() { _entries.length = 0; notify(); }

export function push(entry) { _entries.push(entry); notify(); }

export function get(index) { return _entries[index] ?? null; }

export function update(index, patch) {
  if (_entries[index]) { Object.assign(_entries[index], patch); notify(); }
}

export function getAll() { return _entries; }

// Move the entry at `from` to position `to` (used by drag-to-reorder).
export function move(from, to) {
  if (from === to || from < 0 || to < 0 ||
      from >= _entries.length || to >= _entries.length) return;
  const [moved] = _entries.splice(from, 1);
  _entries.splice(to, 0, moved);
  notify();
}

// Current index of a cell's entry (handlers resolve this live so positional
// indices stay correct after a reorder).
export function indexOfCell(cell) {
  return _entries.findIndex(e => e.cell === cell);
}
