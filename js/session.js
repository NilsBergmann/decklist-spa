// ── SESSION AUTO-SAVE ────────────────────────────────────────────────────────
// Persists the full working session (every generated deck + its per-deck
// overrides: watermark/style/art/colorOverride/blendRatio/artTransform/
// autoSort) to localStorage, debounced off state.js's change notifications —
// so an accidental reload/tab-close mid-editing-pass doesn't lose the work.
// Restoring is never automatic/silent: main.js prompts the user (see
// restoreSessionBanner) and only calls renderDecks on an explicit "Restore".

import { getAll as getAllState } from './state.js?v=3';

const SESSION_KEY = 'decklist:session';
const DEBOUNCE_MS = 500;

let saveTimer = null;

// Mirrors the perDeckSettings shape renderDecks()/decksToYaml() already use —
// deliberately omits `model`/`cell` (DOM-bound, rebuilt on restore via
// buildDeckModel inside renderDecks, not serializable anyway).
function serialize() {
  return getAllState().map(e => ({
    deck:          e.deck,
    wmKey:         e.wmKey ?? null,
    styleKey:      e.styleKey ?? null,
    artOverride:   e.artOverride ?? null,
    colorOverride: e.colorOverride ?? null,
    blendRatio:    e.blendRatio ?? null,
    artTransform:  e.artTransform ?? null,
    autoSort:      e.autoSort ?? null,
  }));
}

export function saveSessionNow() {
  try {
    const entries = serialize();
    if (!entries.length) { localStorage.removeItem(SESSION_KEY); return; }
    localStorage.setItem(SESSION_KEY, JSON.stringify({ savedAt: Date.now(), entries }));
  } catch {
    // Quota exceeded or a non-serializable value snuck into an entry — losing
    // auto-save isn't worth surfacing an error over; the user can still
    // Export YAML manually.
  }
}

// Debounced — state.js's change notification fires on every single mutation
// (one per card during a multi-deck render), so saving immediately on each
// would mean writing to localStorage dozens of times in a row.
export function scheduleSessionSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSessionNow, DEBOUNCE_MS);
}

export function loadSession() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY));
    return parsed?.entries?.length ? parsed : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  clearTimeout(saveTimer);
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}
