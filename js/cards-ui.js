// ── CARD UI: CELLS, OVERLAYS, MODALS, DOWNLOAD ──────────────────────────────
// Owns: per-card cell creation, overlay buttons, fullscreen + edit modals,
// per-card watermark selector, single + batch PNG download, downsample helper.

import { get as registryGet, list as registryList } from './render/registry.js?v=1';
import { buildDeckModel }      from './deck-model.js?v=5';
import { getWatermarks }       from './watermarks.js?v=3';
import { parseManualDeck, deckToManualText, decksToYaml, resolveArtUrl, searchScryfallArt } from './cube-source.js?v=35';
import {
  clear as clearState, push as pushState,
  get as getState, update as updateState, getAll as getAllState,
  move as moveState, indexOfCell,
} from './state.js?v=2';

// ── DISPLAY CANVAS DIMENSIONS (screen resolution) ────────────────────────────

const DPR = window.devicePixelRatio || 1;
const D_W = Math.round(63 * 6 * DPR);
const D_H = Math.round(88 * 6 * DPR);

// Edit-modal live preview: smaller than the grid cell, still crisp.
const P_W = Math.round(63 * 5 * DPR);
const P_H = Math.round(88 * 5 * DPR);

// ── CANVAS HELPERS ───────────────────────────────────────────────────────────

function downsample(srcCanvas, screenCanvas, w = D_W, h = D_H) {
  screenCanvas.width  = w;
  screenCanvas.height = h;
  const sctx = screenCanvas.getContext('2d');
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(srcCanvas, 0, 0, w, h);
}

// Free a canvas backing store immediately (don't wait for GC).
function disposeCanvas(canvas) {
  canvas.width = 0;
  canvas.height = 0;
}

// Render a model full-resolution into a throwaway offscreen canvas.
// The caller owns disposal (disposeCanvas) once it has consumed the pixels.
async function renderFullRes(index) {
  const entry = getState(index);
  if (!entry?.model) return null;
  const renderer = registryGet(entry.styleKey) ?? registryGet('m15');
  await renderer.preload(entry.model);
  const canvas = document.createElement('canvas');
  await renderer.render(canvas, entry.model);
  return canvas;
}

// ── RENDER ONE CELL (shared by generate, edit-save, per-card wm change) ──────
// Renders full-res into a temporary offscreen canvas, downsamples into the
// in-DOM display canvas, then drops the full-res canvas — no print canvas is
// kept in the DOM during normal viewing.

export async function renderOneCell(index) {
  const entry = getState(index);
  if (!entry) return;
  const artOverride = await resolveArtUrl(entry.artOverride ?? '');
  const model = buildDeckModel(entry.deck, entry.wmKey, artOverride, { colorOverride: entry.colorOverride, blendRatio: entry.blendRatio, artTransform: entry.artTransform });
  updateState(index, { model });
  const tmp = await renderFullRes(index);
  if (!tmp) return;
  downsample(tmp, entry.cell.querySelector('.card--screen'));
  disposeCanvas(tmp);
}

// ── RE-RENDER ALL CELLS (after a global option change) ──────────────────────
// Applies an optional state patch (e.g. { styleKey }, { wmKey }, { artOverride })
// to every entry, then re-renders. No-op when nothing has been generated yet.

export async function rerenderAll(patch) {
  const all = getAllState();
  if (!all.length) return;
  await Promise.all(all.map((_, i) => {
    if (patch) updateState(i, patch);
    return renderOneCell(i);
  }));
}

// ── RENDER ALL DECKS ──────────────────────────────────────────────────────────

// perDeckSettings[i] (from a YAML import) can override wmKey/styleKey/
// artOverride/colorOverride/blendRatio/artTransform for that one deck; any
// field left null falls back to the generator's current global selection —
// this is also how a plain Generate/manual-parse call (perDeckSettings
// omitted) keeps applying one uniform setting to every deck, as before.
export async function renderDecks(decks, wmKey, styleKey = 'm15', artOverride = '', perDeckSettings = null) {
  const grid = document.getElementById('cardGrid');
  grid.innerHTML = '';
  clearState();

  // Create all cells first so the DOM populates immediately.
  // Only the lightweight display canvas lives in the DOM during viewing;
  // full-res print canvases are materialized on demand (print/download).
  const cells = decks.map((deck, i) => {
    const cell = document.createElement('div');
    cell.className = 'card-cell';

    const screenC = document.createElement('canvas');
    screenC.className = 'card card--screen';
    cell.appendChild(screenC);

    const s = perDeckSettings?.[i] ?? {};
    pushState({
      deck,
      wmKey:         s.wmKey ?? wmKey,
      styleKey:      s.styleKey ?? styleKey,
      artOverride:   s.artOverride ?? artOverride,
      colorOverride: s.colorOverride ?? null,
      blendRatio:    s.blendRatio ?? null,
      artTransform:  s.artTransform ?? { x: 0, y: 0, zoom: 1 },
      model: null, cell,
    });
    addCardOverlay(cell, i);
    return cell;
  });
  grid.append(...cells);

  // Render all cards concurrently, each into a throwaway full-res canvas.
  await Promise.all(decks.map(async (deck, i) => {
    const entry = getState(i);
    const resolvedArt = await resolveArtUrl(entry.artOverride);
    updateState(i, { model: buildDeckModel(deck, entry.wmKey, resolvedArt, { colorOverride: entry.colorOverride, blendRatio: entry.blendRatio, artTransform: entry.artTransform }) });
    const tmp = await renderFullRes(i);
    if (!tmp) return;
    downsample(tmp, cells[i].querySelector('.card--screen'));
    disposeCanvas(tmp);
  }));
}

// ── DOWNLOAD ─────────────────────────────────────────────────────────────────

function cardFileName(entry, index) {
  return ((entry?.model?.name ?? entry?.deck?.name ?? `card-${index + 1}`)
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
}

function downloadCanvas(canvas, filename) {
  const a = document.createElement('a');
  a.download = `${filename}.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
}

async function downloadCell(index) {
  const canvas = await renderFullRes(index);
  if (!canvas) return;
  downloadCanvas(canvas, cardFileName(getState(index), index));
  disposeCanvas(canvas);
}

// Re-render each card full-res one at a time so peak memory stays at a single
// full-res canvas rather than holding all of them at once.
export async function downloadAll() {
  const all = getAllState();
  for (let i = 0; i < all.length; i++) {
    const canvas = await renderFullRes(i);
    if (!canvas) continue;
    downloadCanvas(canvas, cardFileName(all[i], i));
    disposeCanvas(canvas);
  }
}

// D1: export all current decks as a single YAML file
export function downloadDecksYaml() {
  const entries = getAllState();
  if (!entries.length) return;
  const blob = new Blob([decksToYaml(entries)], { type: 'text/yaml' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.download = 'decklist.yaml';
  a.href = url;
  a.click();
  URL.revokeObjectURL(url);
}

// ── PRINT: ON-DEMAND FULL-RES CANVASES ───────────────────────────────────────
// Print needs full-res 2010×2814 canvases in the DOM so the @media print CSS
// can swap them in. We materialize them just before printing and dispose them
// immediately after, so they never weigh down normal viewing.

export async function materializePrintCanvases() {
  await Promise.all(getAllState().map(async (entry, i) => {
    const canvas = await renderFullRes(i);
    if (!canvas) return;
    canvas.className = 'card card--print';
    // Replace any stale print canvas left from a previous (interrupted) run.
    entry.cell.querySelector('.card--print')?.remove();
    entry.cell.appendChild(canvas);
  }));
}

export function disposePrintCanvases() {
  getAllState().forEach(entry => {
    const printC = entry.cell.querySelector('.card--print');
    if (!printC) return;
    disposeCanvas(printC);
    printC.remove();
  });
}

// Browser-initiated print (Ctrl+P) and post-print cleanup. The print button in
// main.js awaits materializePrintCanvases() before window.print(); afterprint
// reliably fires for both that path and Ctrl+P, so cleanup lives here.
window.addEventListener('afterprint', disposePrintCanvases);

// ── FULLSCREEN LIGHTBOX ───────────────────────────────────────────────────────

const fullscreenModal  = document.getElementById('fullscreenModal');
const fullscreenCanvas = document.getElementById('fullscreenCanvas');

// ── MODAL FOCUS MANAGEMENT (a11y) ────────────────────────────────────────────
// Remember what had focus before a modal opened so it can be restored on close,
// and keep Tab focus cycling within the open modal.

let _returnFocus = null;

function trapFocus(modal, e) {
  if (e.key !== 'Tab') return;
  const focusable = [...modal.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  )].filter(el => !el.disabled && el.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function restoreFocus() {
  _returnFocus?.focus?.();
  _returnFocus = null;
}

function closeFullscreen() {
  if (fullscreenModal.style.display === 'none') return;
  fullscreenModal.style.display = 'none';
  disposeCanvas(fullscreenCanvas);   // free the full-res backing store
  restoreFocus();
}

document.getElementById('fullscreenClose').addEventListener('click', closeFullscreen);
fullscreenModal.addEventListener('click', e => {
  if (e.target === fullscreenModal) closeFullscreen();
});
fullscreenModal.addEventListener('keydown', e => trapFocus(fullscreenModal, e));

async function openFullscreen(index) {
  _returnFocus = document.activeElement;
  const src = await renderFullRes(index);
  if (!src) return;
  fullscreenCanvas.width  = src.width;
  fullscreenCanvas.height = src.height;
  fullscreenCanvas.getContext('2d').drawImage(src, 0, 0);
  disposeCanvas(src);
  fullscreenModal.style.display = 'flex';
  document.getElementById('fullscreenClose').focus();
}

// ── EDIT MODAL ────────────────────────────────────────────────────────────────

const editModal           = document.getElementById('editModal');
const editTextarea        = document.getElementById('editTextarea');
const editSubtitleGroup   = document.getElementById('editSubtitleGroup');
const editSubtitleInput   = document.getElementById('editSubtitle');
const editArtUrlGroup     = document.getElementById('editArtUrlGroup');
const editArtUrlInput     = document.getElementById('editArtUrl');
const editArtPreview      = document.getElementById('editArtPreview');
const editArtPicker       = document.getElementById('editArtPicker');
const artPickerDeckPane   = document.getElementById('artPickerDeckPane');
const artPickerSearchPane = document.getElementById('artPickerSearchPane');
const artPickerGrid       = document.getElementById('artPickerGrid');
const artPickerSearch     = document.getElementById('artPickerSearch');
const artPickerSearchGrid = document.getElementById('artPickerSearchGrid');
const artPickerSearchStatus = document.getElementById('artPickerSearchStatus');
const editPreviewCanvas   = document.getElementById('editPreviewCanvas');
const editColorToggles    = document.getElementById('editColorToggles');
const editBlendGroup      = document.getElementById('editBlendGroup');
const editBlendSlider     = document.getElementById('editBlendSlider');
const editBlendValue      = document.getElementById('editBlendValue');
const editArtTransform     = document.getElementById('editArtTransform');
const editArtZoom          = document.getElementById('editArtZoom');
const editArtTransformReset = document.getElementById('editArtTransformReset');
let   editingIndex = -1;

const MODAL_ART_STYLES = new Set(['art-bg', 'cover']);

// ── COLOR OVERRIDE (edit modal) ───────────────────────────────────────────────
// Modal-local working copy of the per-card colorOverride: null = auto, otherwise
// an array of letters from W/U/B/R/G (or ['C'] for colorless). Seeded in
// openEdit, mutated by the toggle buttons, persisted on save.
let editColorOverride = null;

// Sync the toggle buttons' pressed state to editColorOverride.
function syncColorToggles() {
  const active = new Set(editColorOverride ?? []);
  for (const btn of editColorToggles.querySelectorAll('.color-toggle')) {
    const on = btn.dataset.color === 'auto'
      ? editColorOverride === null
      : active.has(btn.dataset.color);
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  }
}

// Toggle one color letter (or reset to auto). 'C' is mutually exclusive with the
// WUBRG letters. Selecting nothing collapses back to auto (null).
function toggleColor(color) {
  if (color === 'auto') { editColorOverride = null; return; }
  let cur = editColorOverride ? [...editColorOverride] : [];
  if (color === 'C') {
    cur = cur.includes('C') ? [] : ['C'];
  } else {
    cur = cur.filter(c => c !== 'C');
    cur = cur.includes(color) ? cur.filter(c => c !== color) : [...cur, color];
  }
  editColorOverride = cur.length ? cur : null;
}

editColorToggles.addEventListener('click', e => {
  const btn = e.target.closest('.color-toggle');
  if (!btn) return;
  toggleColor(btn.dataset.color);
  syncColorToggles();
  scheduleCardPreview();
});

// ── COLOR BLEND SLIDER (edit modal) ───────────────────────────────────────────
// Styles where the two-color blend slider is meaningful (m15 frame/watermark
// split is the primary effect of splitRatio).
const MODAL_BLEND_STYLES = new Set(['m15']);

// Slider snap targets: every multiple of 10, plus 25/50/75.
const BLEND_SNAP = [...Array.from({ length: 11 }, (_, i) => i * 10), 25, 50, 75]
  .sort((a, b) => a - b);

function snapBlend(value) {
  return BLEND_SNAP.reduce((best, t) =>
    Math.abs(t - value) < Math.abs(best - value) ? t : best, BLEND_SNAP[0]);
}

// Current blend override from the modal slider: null when the deck isn't a
// two-color blend style (slider hidden) so buildDeckModel falls back to auto.
function currentBlendRatio() {
  if (editBlendGroup.style.display === 'none') return null;
  return Number(editBlendSlider.value) / 100;
}

// ── ART REPOSITION (drag-to-pan + zoom) ───────────────────────────────────────
// Working transform edited live in the modal; seeded from entry.artTransform in
// openEdit and persisted on save. buildPreviewModel reads it so dragging/zooming
// updates the live preview immediately.

const DEFAULT_TRANSFORM = { x: 0, y: 0, zoom: 1 };
const ZOOM_MIN = 1, ZOOM_MAX = 3;

let _workingTransform = { ...DEFAULT_TRANSFORM };

const clampZoom = z => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

function closeEdit() {
  if (editModal.style.display === 'none') return;
  editModal.style.display = 'none';
  _cardPreviewSeq++;                 // cancel any in-flight preview render
  clearTimeout(_cardPreviewTimer);
  clearTimeout(_liveIdleTimer);
  _liveSession = null;                // drop the cached live-drag model
  disposeCanvas(editPreviewCanvas);  // free the preview backing store
  restoreFocus();
}

document.getElementById('editClose').addEventListener('click',    closeEdit);
document.getElementById('editCancelBtn').addEventListener('click', closeEdit);
editModal.addEventListener('click', e => { if (e.target === editModal) closeEdit(); });
editModal.addEventListener('keydown', e => trapFocus(editModal, e));

// ── ART PICKER HELPERS ────────────────────────────────────────────────────────

function setArtPreview(resolvedUrl) {
  editArtPreview.innerHTML = resolvedUrl
    ? `<img src="${resolvedUrl}" alt="">`
    : '';
}

function buildArtThumb(artUrl, name, isSelected, withFindButton = false) {
  const div = document.createElement('div');
  div.className = 'art-picker-thumb' + (isSelected ? ' selected' : '');
  div.title = name;
  const img = document.createElement('img');
  img.src = artUrl; img.alt = ''; img.loading = 'lazy';
  // Mark broken thumbnails so CSS can show a fallback instead of an empty box.
  img.addEventListener('error', () => div.classList.add('art-picker-thumb--broken'));
  const lbl = document.createElement('div');
  lbl.className = 'art-picker-thumb-name';
  lbl.textContent = name;
  div.append(img, lbl);
  // Deck-tab thumbs get a "find more" button: jump to the Scryfall search tab
  // pre-filled with this card's name to browse its other printings/artworks.
  if (withFindButton) {
    const find = document.createElement('button');
    find.type = 'button';
    find.className = 'art-picker-thumb-find';
    find.title = 'Find other artworks';
    find.setAttribute('aria-label', 'Find other artworks');
    find.textContent = '🔍';
    find.addEventListener('click', e => {
      e.stopPropagation();                 // don't trigger the thumb's select-art
      findOtherArtworks(name);
    });
    div.appendChild(find);
  }
  div.addEventListener('click', () => {
    document.querySelectorAll('.art-picker-thumb.selected').forEach(t => t.classList.remove('selected'));
    div.classList.add('selected');
    editArtUrlInput.value = artUrl;
    setArtPreview(artUrl);
    scheduleCardPreview();
  });
  return div;
}

// Activate the Scryfall search tab pre-filled with a card name and run it.
// Reuses the tab buttons' own click logic by clicking the search tab.
function findOtherArtworks(name) {
  document.querySelector('.art-picker-tab[data-picker-tab="search"]')?.click();
  artPickerSearch.value = name;
  runArtSearch(name);
}

function populateDeckArtGrid(deck) {
  artPickerGrid.innerHTML = '';
  const seen = new Set();
  const items = [];
  for (const card of deck.cards) {
    if (!card.art || seen.has(card.art)) continue;
    seen.add(card.art);
    items.push({ artUrl: card.art, name: card.name });
  }
  if (!items.length) {
    const msg = document.createElement('div');
    msg.className = 'art-picker-empty';
    msg.textContent = 'No art in this deck — use Search Scryfall';
    artPickerGrid.appendChild(msg);
    return;
  }
  const currentArt = editArtUrlInput.value.trim();
  for (const { artUrl, name } of items) {
    artPickerGrid.appendChild(buildArtThumb(artUrl, name, artUrl === currentArt, true));
  }
}

// Tab switching
document.querySelectorAll('.art-picker-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.art-picker-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const pane = tab.dataset.pickerTab;
    artPickerDeckPane.style.display   = pane === 'deck'   ? '' : 'none';
    artPickerSearchPane.style.display = pane === 'search' ? '' : 'none';
    // Show the search hint the first time the Search tab is opened with no query.
    if (pane === 'search' && !artPickerSearchGrid.childElementCount && !artPickerSearchStatus.textContent) {
      artPickerSearchStatus.textContent = 'Type a card name to search Scryfall.';
    }
  });
});

// Scryfall search. A monotonic sequence id guards against a slow earlier
// request resolving after a newer one and overwriting fresher results.
let _searchTimer = null;
let _searchSeq   = 0;

async function runArtSearch(q) {
  const seq = ++_searchSeq;                 // invalidate any in-flight request
  if (!q) {
    artPickerSearchGrid.innerHTML = '';
    artPickerSearchStatus.textContent = 'Type a card name to search Scryfall.';
    return;
  }
  if (q.length < 2) {
    artPickerSearchGrid.innerHTML = '';
    artPickerSearchStatus.textContent = 'Type at least 2 characters.';
    return;
  }
  artPickerSearchStatus.textContent = 'Searching…';
  artPickerSearchGrid.innerHTML = '';
  const results = await searchScryfallArt(q);
  if (seq !== _searchSeq) return;           // a newer search superseded this one
  if (!results.length) {
    artPickerSearchStatus.textContent = `No results for “${q}”.`;
    return;
  }
  artPickerSearchStatus.textContent =
    `${results.length} result${results.length !== 1 ? 's' : ''}`;
  const currentArt = editArtUrlInput.value.trim();
  for (const { artUrl, name } of results) {
    artPickerSearchGrid.appendChild(buildArtThumb(artUrl, name, artUrl === currentArt));
  }
}

artPickerSearch.addEventListener('input', () => {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => runArtSearch(artPickerSearch.value.trim()), 400);
});
// Enter searches immediately (skips the debounce).
artPickerSearch.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); clearTimeout(_searchTimer); runArtSearch(artPickerSearch.value.trim()); }
});

// Reset art to automatic: clear the override, preview, and any selected thumb.
document.getElementById('editArtReset').addEventListener('click', () => {
  editArtUrlInput.value = '';
  setArtPreview('');
  document.querySelectorAll('.art-picker-thumb.selected').forEach(t => t.classList.remove('selected'));
  scheduleCardPreview();
  editArtUrlInput.focus();
});

// Live art preview as URL is typed
let _previewTimer = null;
editArtUrlInput.addEventListener('input', () => {
  clearTimeout(_previewTimer);
  const val = editArtUrlInput.value.trim();
  if (val) {
    _previewTimer = setTimeout(async () => {
      const resolved = await resolveArtUrl(val);
      setArtPreview(resolved);
    }, 600);
  } else {
    setArtPreview('');
  }
  scheduleCardPreview();
});

// ── LIVE CARD PREVIEW (full card, rendered from the modal's current values) ────
// A sequence id cancels stale renders: rapid edits bump _cardPreviewSeq, and any
// render whose captured id is no longer current discards its result.

let _cardPreviewSeq   = 0;
let _cardPreviewTimer = null;

// Build a throwaway deck model from the modal's CURRENT field values (not the
// saved state), mirroring what the Re-render save handler will eventually do.
async function buildPreviewModel() {
  const entry = getState(editingIndex);
  if (!entry) return null;
  const styleKey = entry.styleKey ?? 'm15';

  const parsed = parseManualDeck(editTextarea.value.trim());
  if (!parsed.length) return null;
  const deck = parsed[0];

  if (styleKey === 'cover') {
    const subtitle  = editSubtitleInput.value.trim();
    const baseTitle = deck.name.split('|')[0].trim();
    deck.name = subtitle ? `${baseTitle} | ${subtitle}` : baseTitle;
  }

  let artOverride = '';
  let artTransform = entry.artTransform;
  if (MODAL_ART_STYLES.has(styleKey)) {
    artOverride = await resolveArtUrl(editArtUrlInput.value.trim());
    artTransform = _workingTransform;   // live drag/zoom while the modal is open
  }

  return {
    model: buildDeckModel(deck, entry.wmKey, artOverride, {
      colorOverride: editColorOverride,
      blendRatio: currentBlendRatio(),
      artTransform,
    }),
    styleKey,
  };
}

async function renderCardPreview() {
  const seq = ++_cardPreviewSeq;
  let built;
  try { built = await buildPreviewModel(); } catch { return; }
  if (!built || seq !== _cardPreviewSeq) return;   // bad input or superseded

  const renderer = registryGet(built.styleKey) ?? registryGet('m15');
  const tmp = document.createElement('canvas');
  try {
    await renderer.preload(built.model);
    if (seq !== _cardPreviewSeq) return;
    await renderer.render(tmp, built.model);
  } catch {
    disposeCanvas(tmp);
    return;
  }
  if (seq !== _cardPreviewSeq) { disposeCanvas(tmp); return; }

  downsample(tmp, editPreviewCanvas, P_W, P_H);
  disposeCanvas(tmp);
}

function scheduleCardPreview() {
  _liveSession = null;   // field values changed — the cached live-drag model is stale
  clearTimeout(_cardPreviewTimer);
  _cardPreviewTimer = setTimeout(renderCardPreview, 300);
}

// ── ART REPOSITION CONTROLS ───────────────────────────────────────────────────
// Show/hide the pan+zoom controls for art styles, seed them from a transform,
// and wire drag (pan), the zoom slider/wheel, and the reset button.

function showArtTransformControls(show) {
  editArtTransform.style.display = show ? '' : 'none';
  editPreviewCanvas.classList.toggle('art-pannable', show);
}

function seedArtTransform(transform) {
  _workingTransform = {
    x: transform?.x ?? 0,
    y: transform?.y ?? 0,
    zoom: clampZoom(transform?.zoom ?? 1),
  };
  editArtZoom.value = String(_workingTransform.zoom);
}

// ── FAST LIVE PREVIEW FOR PAN/ZOOM ────────────────────────────────────────────
// Routing every pointer move through the debounced buildPreviewModel pipeline
// (re-parse deck text, re-resolve art URL, full-res render) feels laggy. During a
// pan/zoom gesture we build the model + preload the art ONCE, then re-render
// coalesced via requestAnimationFrame, mutating only artTransform. The cached
// session expires shortly after the last move so later edits rebuild normally.
let _liveSession = null;                 // { renderer, model } during a gesture
let _liveBuilding = false;
let _liveBusy = false, _liveDirty = false;
let _liveIdleTimer = null;

async function ensureLiveSession() {
  if (_liveSession || _liveBuilding) return;
  _liveBuilding = true;
  try {
    const built = await buildPreviewModel();
    if (built) {
      const renderer = registryGet(built.styleKey) ?? registryGet('m15');
      await renderer.preload(built.model);
      _liveSession = { renderer, model: built.model };
    }
  } finally { _liveBuilding = false; }
  if (_liveSession) requestLiveFrame();
}

function requestLiveFrame() {
  if (!_liveSession) return;
  _liveDirty = true;
  if (_liveBusy) return;                  // a frame is already in flight
  _liveBusy = true;
  requestAnimationFrame(runLiveFrame);
}

async function runLiveFrame() {
  if (!_liveSession) { _liveBusy = false; return; }
  _liveDirty = false;
  _liveSession.model.artTransform = { ..._workingTransform };
  const tmp = document.createElement('canvas');
  try { await _liveSession.renderer.render(tmp, _liveSession.model); } catch {}
  if (tmp.width) { downsample(tmp, editPreviewCanvas, P_W, P_H); disposeCanvas(tmp); }
  // Coalesce: if more moves arrived mid-render, draw one more frame.
  if (_liveSession && _liveDirty) requestAnimationFrame(runLiveFrame);
  else _liveBusy = false;
}

// Immediate, coalesced preview update for a transform change (no 300ms debounce).
function liveTransform() {
  clearTimeout(_liveIdleTimer);
  _liveIdleTimer = setTimeout(() => { _liveSession = null; }, 500);
  if (_liveSession) requestLiveFrame();
  else ensureLiveSession();
}

// Drag-to-pan: deltas are normalized by the on-screen canvas size so x/y stay in
// roughly -1..1 regardless of the preview's rendered dimensions.
let _panning = false, _panStartX = 0, _panStartY = 0, _panBaseX = 0, _panBaseY = 0;

editPreviewCanvas.addEventListener('mousedown', e => {
  if (editArtTransform.style.display === 'none') return;   // not an art style
  e.preventDefault();
  _panning = true;
  _panStartX = e.clientX; _panStartY = e.clientY;
  _panBaseX = _workingTransform.x; _panBaseY = _workingTransform.y;
  editPreviewCanvas.classList.add('panning');
  ensureLiveSession();                    // warm the cache for a smooth drag
});

window.addEventListener('mousemove', e => {
  if (!_panning) return;
  const rect = editPreviewCanvas.getBoundingClientRect();
  _workingTransform.x = _panBaseX + (e.clientX - _panStartX) / rect.width;
  _workingTransform.y = _panBaseY + (e.clientY - _panStartY) / rect.height;
  liveTransform();
});

window.addEventListener('mouseup', () => {
  if (!_panning) return;
  _panning = false;
  editPreviewCanvas.classList.remove('panning');
});

// Zoom: slider + mouse wheel (clamped ZOOM_MIN..ZOOM_MAX).
editArtZoom.addEventListener('input', () => {
  _workingTransform.zoom = clampZoom(parseFloat(editArtZoom.value));
  liveTransform();
});

editPreviewCanvas.addEventListener('wheel', e => {
  if (editArtTransform.style.display === 'none') return;   // not an art style
  e.preventDefault();
  _workingTransform.zoom = clampZoom(_workingTransform.zoom - e.deltaY * 0.001);
  editArtZoom.value = String(_workingTransform.zoom);
  liveTransform();
}, { passive: false });

editArtTransformReset.addEventListener('click', () => {
  seedArtTransform(DEFAULT_TRANSFORM);
  liveTransform();
});

// Every editable input that feeds buildPreviewModel re-renders the preview:
// deck text (incl. the title line), subtitle, and the art URL. Art-thumbnail
// clicks (deck grid + Scryfall search) call scheduleCardPreview from their own
// handlers in buildArtThumb. The watermark is not editable inside the modal.
editTextarea.addEventListener('input', scheduleCardPreview);
editSubtitleInput.addEventListener('input', scheduleCardPreview);

// ── BLEND SLIDER ──────────────────────────────────────────────────────────────
// Update the readout, snap to an allowed value, and live-preview the blend.

function setBlendReadout(pct) {
  editBlendValue.textContent = `${Math.round(pct)}%`;
}

editBlendSlider.addEventListener('input', () => {
  const snapped = snapBlend(Number(editBlendSlider.value));
  editBlendSlider.value = String(snapped);
  setBlendReadout(snapped);
  scheduleCardPreview();
});

// Reset to automatic: re-seed the slider from the deck's computed split, and
// flag the saved blendRatio for clearing (handled in the save handler).
let _blendAuto = true;   // true while the slider tracks the auto split
document.getElementById('editBlendReset').addEventListener('click', () => {
  _blendAuto = true;
  seedBlendSlider();
  scheduleCardPreview();
  editBlendSlider.focus();
});

// Any manual drag opts out of auto mode (so save persists the chosen ratio).
editBlendSlider.addEventListener('pointerdown', () => { _blendAuto = false; });
editBlendSlider.addEventListener('keydown',     () => { _blendAuto = false; });

// Seed the slider from the deck's CURRENT computed split (auto preset), built
// once with no override. Falls back to 50% if the model can't be built.
function seedBlendSlider() {
  const entry = getState(editingIndex);
  let pct = 50;
  if (entry) {
    try {
      const auto = buildDeckModel(entry.deck, entry.wmKey, '').splitRatio;
      pct = snapBlend(Math.round(auto * 100));
    } catch { /* keep 50 */ }
  }
  editBlendSlider.value = String(pct);
  setBlendReadout(pct);
}

document.getElementById('editSaveBtn').addEventListener('click', async () => {
  const text = editTextarea.value.trim();
  if (!text || editingIndex < 0) return;

  const parsed = parseManualDeck(text);
  if (!parsed.length) { alert('No cards found — check the format.'); return; }

  const deck      = parsed[0];
  const entry     = getState(editingIndex);
  const styleKey  = entry?.styleKey ?? 'm15';

  // ── Preserve per-card art (e.g. Cubecobra art_crop) ──
  // parseManualDeck doesn't produce an `art` field, so carry it over from the
  // previous deck by matching on card name. New cards just won't have art.
  const artByName = new Map();
  for (const c of entry?.deck?.cards ?? []) if (c.art) artByName.set(c.name, c.art);
  for (const c of deck.cards) if (!c.art && artByName.has(c.name)) c.art = artByName.get(c.name);

  // Merge subtitle back into deck name (cover style only)
  if (styleKey === 'cover') {
    const subtitle = editSubtitleInput.value.trim();
    const baseTitle = deck.name.split('|')[0].trim();
    deck.name = subtitle ? `${baseTitle} | ${subtitle}` : baseTitle;
  }

  const patch = { deck, colorOverride: editColorOverride };
  if (MODAL_ART_STYLES.has(styleKey)) {
    patch.artOverride = editArtUrlInput.value.trim();
    patch.artTransform = { ..._workingTransform };
  }
  if (MODAL_BLEND_STYLES.has(styleKey)) {
    // Auto mode persists null (re-derives from pip counts); otherwise the chosen ratio.
    patch.blendRatio = _blendAuto ? null : Number(editBlendSlider.value) / 100;
  }
  updateState(editingIndex, patch);

  const saveBtn = document.getElementById('editSaveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Rendering…';
  try {
    await renderOneCell(editingIndex);
    closeEdit();
  } catch (err) {
    alert(`Render error: ${err.message}`);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Re-render';
  }
});

function openEdit(index) {
  const entry = getState(index);
  if (!entry) return;

  _returnFocus = document.activeElement;
  const styleKey = entry.styleKey ?? 'm15';

  // Subtitle: cover only — extract from the "Title | Subtitle" deck name
  const isCover = styleKey === 'cover';
  editSubtitleGroup.style.display = isCover ? '' : 'none';
  if (isCover) {
    const parts = (entry.deck.name ?? '').split('|');
    editSubtitleInput.value = parts.slice(1).join('|').trim();
  }

  // Art URL + picker: art-bg and cover
  const hasArt = MODAL_ART_STYLES.has(styleKey);
  editArtUrlGroup.style.display = hasArt ? '' : 'none';
  editArtPicker.style.display   = hasArt ? '' : 'none';
  showArtTransformControls(hasArt);
  seedArtTransform(entry.artTransform);   // also resets working transform for non-art styles
  _liveSession = null;                    // drop any cached model from a previously-edited card
  if (hasArt) {
    const artVal = entry.artOverride ?? '';
    editArtUrlInput.value = artVal;
    // Reset to deck tab
    document.querySelectorAll('.art-picker-tab').forEach((t, i) => t.classList.toggle('active', i === 0));
    artPickerDeckPane.style.display   = '';
    artPickerSearchPane.style.display = 'none';
    artPickerSearch.value = '';
    artPickerSearchGrid.innerHTML = '';
    artPickerSearchStatus.textContent = '';
    populateDeckArtGrid(entry.deck);
    // The preview swatch should reflect what's actually in use right now: the
    // manual override if set, otherwise the deck's auto-selected art (already
    // resolved onto entry.model by the last render) — not a blank swatch just
    // because artVal (the override field) is empty.
    resolveArtUrl(artVal || entry.model?.artUrl || '').then(setArtPreview);
  }

  editingIndex = index;            // seedBlendSlider + preview read the current entry

  // Color override: applies to every style (drives pips/gradients/frame).
  editColorOverride = Array.isArray(entry.colorOverride) && entry.colorOverride.length
    ? [...entry.colorOverride]
    : null;
  syncColorToggles();

  // Blend slider: m15 only. Seed from the saved override, or the deck's
  // computed auto split when there's none.
  const hasBlend = MODAL_BLEND_STYLES.has(styleKey);
  editBlendGroup.style.display = hasBlend ? '' : 'none';
  if (hasBlend) {
    _blendAuto = entry.blendRatio == null;
    if (_blendAuto) {
      seedBlendSlider();
    } else {
      const pct = snapBlend(Math.round(entry.blendRatio * 100));
      editBlendSlider.value = String(pct);
      setBlendReadout(pct);
    }
  }

  editTextarea.value = deckToManualText(entry.deck);
  editModal.style.display = 'flex';
  editTextarea.focus();
  renderCardPreview();   // seed the live preview with the current card
}

// ── ESC TO CLOSE MODALS ───────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeFullscreen();
    if (editModal.style.display !== 'none') closeEdit();
    if (batchEditModal.style.display !== 'none') closeBatchEdit();
  }
});

// ── INLINE TITLE EDIT (double-click a card) ──────────────────────────────────
// A lightweight rename affordance: double-clicking a card shows an inline
// title input (plus a subtitle input for the cover style) over the top of the
// card. Enter / blur commits and re-renders; Escape cancels. For the full deck
// list use the edit modal (✎).

function startInlineTitleEdit(cell) {
  if (cell.querySelector('.inline-title-edit')) return;   // already editing
  const i = indexOfCell(cell);
  const entry = getState(i);
  if (!entry) return;

  const isCover = (entry.styleKey ?? 'm15') === 'cover';
  const [rawTitle, ...rest] = (entry.deck.name ?? '').split('|');

  const box = document.createElement('div');
  box.className = 'inline-title-edit';

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'inline-title-input';
  titleInput.value = rawTitle.trim();
  titleInput.setAttribute('aria-label', 'Card title');
  box.appendChild(titleInput);

  let subInput = null;
  if (isCover) {
    subInput = document.createElement('input');
    subInput.type = 'text';
    subInput.className = 'inline-title-input';
    subInput.placeholder = 'Subtitle';
    subInput.value = rest.join('|').trim();
    subInput.setAttribute('aria-label', 'Card subtitle');
    box.appendChild(subInput);
  }

  cell.classList.add('inline-editing');
  cell.appendChild(box);
  titleInput.focus();
  titleInput.select();

  let done = false;
  const cleanup = () => { cell.classList.remove('inline-editing'); box.remove(); };
  const cancel  = () => { if (done) return; done = true; cleanup(); };
  const commit  = async () => {
    if (done) return; done = true;
    const idx = indexOfCell(cell);                    // resolve live (may have moved)
    const e2  = getState(idx);
    cleanup();
    if (!e2) return;
    const title = titleInput.value.trim() || 'Deck';
    const sub   = subInput ? subInput.value.trim() : '';
    const name  = (isCover && sub) ? `${title} | ${sub}` : title;
    updateState(idx, { deck: { ...e2.deck, name } });
    await renderOneCell(idx);
  };

  for (const inp of box.querySelectorAll('input')) {
    inp.addEventListener('keydown', e => {
      e.stopPropagation();                            // don't trip global Esc
      if (e.key === 'Enter')  { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
  }
  // Commit when focus leaves the whole box (click elsewhere / tab out).
  box.addEventListener('focusout', () => {
    setTimeout(() => { if (!box.contains(document.activeElement)) commit(); }, 0);
  });
}

// ── CARD OVERLAY ──────────────────────────────────────────────────────────────

function addCardOverlay(cell, index) {
  const overlay = document.createElement('div');
  overlay.className = 'card-overlay';

  const btnRow = document.createElement('div');
  btnRow.className = 'card-overlay-btns';
  btnRow.innerHTML = `
    <button class="card-btn btn-fullscreen" title="Fullscreen"   aria-label="Fullscreen">⛶</button>
    <button class="card-btn btn-download"   title="Download PNG" aria-label="Download PNG">↓</button>
    <button class="card-btn btn-edit"       title="Edit"         aria-label="Edit deck">✎</button>
  `;
  overlay.appendChild(btnRow);

  // Resolve this cell's CURRENT index live, so handlers stay correct after a
  // drag reorder (the captured `index` is only valid at creation time).
  const idxOf = () => indexOfCell(cell);

  // Drag handle (reorder the card grid)
  const handle = document.createElement('div');
  handle.className = 'card-drag-handle';
  handle.title = 'Drag to reorder';
  handle.setAttribute('aria-label', 'Drag to reorder');
  handle.textContent = '⠿';
  handle.draggable = true;
  handle.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', String(idxOf()));
    e.dataTransfer.effectAllowed = 'move';
    cell.classList.add('card-cell--dragging');
  });
  handle.addEventListener('dragend', () => cell.classList.remove('card-cell--dragging'));
  overlay.appendChild(handle);

  // Per-card style selector (overrides the global style for this card only)
  const styleSel = document.createElement('select');
  styleSel.className = 'card-wm-select card-style-select';
  styleSel.title = 'Style';
  const currentStyleKey = getState(index)?.styleKey ?? 'm15';
  for (const r of registryList()) {
    const opt = document.createElement('option');
    opt.value = r.key; opt.textContent = r.label;
    if (r.key === currentStyleKey) opt.selected = true;
    styleSel.appendChild(opt);
  }
  overlay.appendChild(styleSel);

  // Per-card watermark selector
  const wmSel = document.createElement('select');
  wmSel.className = 'card-wm-select';
  wmSel.title = 'Watermark';
  const currentWmKey = getState(index)?.wmKey ?? 'none';
  for (const [k, v] of Object.entries(getWatermarks())) {
    const opt = document.createElement('option');
    opt.value = k; opt.textContent = v.label;
    if (k === currentWmKey) opt.selected = true;
    wmSel.appendChild(opt);
  }
  overlay.appendChild(wmSel);

  cell.appendChild(overlay);

  // Double-click the card image to quickly rename it (inline title editor).
  cell.querySelector('.card--screen')?.addEventListener('dblclick', () => startInlineTitleEdit(cell));

  // Drop target: dropping the dragged handle here reorders the grid + state.
  cell.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
  cell.addEventListener('drop', e => {
    e.preventDefault();
    const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
    const to   = idxOf();
    if (Number.isNaN(from) || from === to) return;
    reorderCards(from, to);
  });

  btnRow.querySelector('.btn-fullscreen').addEventListener('click', () => openFullscreen(idxOf()));
  btnRow.querySelector('.btn-download').addEventListener('click',   () => downloadCell(idxOf()));
  btnRow.querySelector('.btn-edit').addEventListener('click',       () => openEdit(idxOf()));

  styleSel.addEventListener('change', async () => {
    const i = idxOf();
    updateState(i, { styleKey: styleSel.value });
    styleSel.disabled = true;
    try { await renderOneCell(i); } finally { styleSel.disabled = false; }
  });

  wmSel.addEventListener('change', async () => {
    const i = idxOf();
    updateState(i, { wmKey: wmSel.value });
    wmSel.disabled = true;
    try { await renderOneCell(i); } finally { wmSel.disabled = false; }
  });
}

// Reorder state + DOM so card `from` lands at position `to`. Handlers resolve
// their index live (idxOf), so no rebinding is needed.
function reorderCards(from, to) {
  moveState(from, to);
  const grid = document.getElementById('cardGrid');
  grid.append(...getAllState().map(e => e.cell));   // re-append moves nodes in place
}

// ── BATCH TITLE/SUBTITLE EDIT ─────────────────────────────────────────────────
// A table view to edit every card's title (and subtitle, per the "Title |
// Subtitle" convention the cover style reads) at once, instead of one at a
// time via double-click or the per-card edit modal. The modal is a full-
// screen overlay, so state order can't shift underneath it — row index i
// safely maps to getState(i) for the whole time it's open.

const batchEditModal = document.getElementById('batchEditModal');
const batchEditTbody = document.getElementById('batchEditTbody');

function splitTitleSubtitle(name) {
  const parts = (name ?? '').split('|');
  return { title: parts[0].trim(), subtitle: parts.slice(1).join('|').trim() };
}

function buildBatchRow(entry) {
  const { title, subtitle } = splitTitleSubtitle(entry.deck.name);
  const row = document.createElement('tr');

  const titleTd = document.createElement('td');
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'title-input';
  titleInput.value = title;
  titleTd.appendChild(titleInput);

  const subTd = document.createElement('td');
  const subInput = document.createElement('input');
  subInput.type = 'text';
  subInput.className = 'subtitle-input';
  subInput.placeholder = 'Subtitle';
  subInput.value = subtitle;
  subTd.appendChild(subInput);

  row.append(titleTd, subTd);
  return row;
}

export function openBatchEdit() {
  const entries = getAllState();
  if (!entries.length) return;
  batchEditTbody.innerHTML = '';
  for (const entry of entries) batchEditTbody.appendChild(buildBatchRow(entry));
  batchEditModal.style.display = 'flex';
  batchEditTbody.querySelector('input')?.focus();
}

function closeBatchEdit() {
  batchEditModal.style.display = 'none';
}

document.getElementById('batchEditClose').addEventListener('click', closeBatchEdit);
document.getElementById('batchEditCancelBtn').addEventListener('click', closeBatchEdit);
batchEditModal.addEventListener('click', e => { if (e.target === batchEditModal) closeBatchEdit(); });

document.getElementById('batchEditSaveBtn').addEventListener('click', async () => {
  const saveBtn = document.getElementById('batchEditSaveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Rendering…';
  try {
    const rows = [...batchEditTbody.children];
    const toRender = [];
    rows.forEach((row, i) => {
      const entry = getState(i);
      if (!entry) return;
      const title    = row.querySelector('.title-input').value.trim() || 'Deck';
      const subtitle = row.querySelector('.subtitle-input').value.trim();
      const newName  = subtitle ? `${title} | ${subtitle}` : title;
      if (newName !== entry.deck.name) {
        updateState(i, { deck: { ...entry.deck, name: newName } });
        toRender.push(i);
      }
    });
    await Promise.all(toRender.map(i => renderOneCell(i)));
    closeBatchEdit();
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Apply & Re-render';
  }
});
