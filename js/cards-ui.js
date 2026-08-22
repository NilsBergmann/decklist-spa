// ── CARD UI: CELLS, OVERLAYS, MODALS, DOWNLOAD ──────────────────────────────
// Owns: per-card cell creation, overlay buttons, fullscreen + edit modals,
// per-card watermark selector, single + batch PNG download, downsample helper.

import { get as registryGet, list as registryList } from './render/registry.js?v=1';
import { buildDeckModel, ROW_COMPARE_BY_TYPE } from './deck-model.js?v=12';
import { getWatermarks }       from './watermarks.js?v=6';
import { decksToYaml, resolveArtUrl, searchScryfallArt, enrichCardsFromScryfall, colorsFromCost } from './cube-source.js?v=44';
import { splitTitleSubtitle, mergeTitleSubtitle } from './text-utils.js?v=2';
import { setStatus } from './status.js?v=1';
import { createZipBlob } from './zip.js?v=1';
import { groupByType, groupDuplicates, compareByRarity } from './card-utils.js?v=5';
import { TYPE_ORDER, RARITY_ORDER } from './config.js?v=3';
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
  const model = buildDeckModel(entry.deck, entry.wmKey, artOverride, { colorOverride: entry.colorOverride, blendRatio: entry.blendRatio, artTransform: entry.artTransform, autoSort: entry.autoSort });
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

// Whether any cards have been generated yet (main.js uses this to decide
// whether a global option change is destructive enough to confirm first).
export function hasCards() {
  return getAllState().length > 0;
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
      autoSort:      s.autoSort ?? true,
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
    updateState(i, { model: buildDeckModel(deck, entry.wmKey, resolvedArt, { colorOverride: entry.colorOverride, blendRatio: entry.blendRatio, artTransform: entry.artTransform, autoSort: entry.autoSort }) });
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
  let canvas;
  try { canvas = await renderFullRes(index); }
  catch (err) { setStatus(`Render error: ${err.message}`, 'error'); return; }
  if (!canvas) return;
  downloadCanvas(canvas, cardFileName(getState(index), index));
  disposeCanvas(canvas);
}

function canvasToPngBytes(canvas) {
  return new Promise(resolve => {
    canvas.toBlob(async blob => resolve(blob ? new Uint8Array(await blob.arrayBuffer()) : null), 'image/png');
  });
}

// De-duplicates a base filename against names already used in this batch
// (e.g. two decks sharing a name) by appending "-2", "-3", ... as needed.
function uniqueFileName(base, usedNames) {
  let name = base;
  let n = 2;
  while (usedNames.has(name)) { name = `${base}-${n}`; n++; }
  usedNames.add(name);
  return name;
}

// Re-render each card full-res one at a time so peak memory stays at a single
// full-res canvas rather than holding all of them at once, then bundle every
// PNG into one zip — downloading N loose files one-by-one either gets
// throttled or triggers a "this site is trying to download multiple files"
// prompt in most browsers.
export async function downloadAll() {
  const all = getAllState();
  const usedNames = new Set();
  const files = [];
  for (let i = 0; i < all.length; i++) {
    let canvas;
    try { canvas = await renderFullRes(i); }
    catch (err) { setStatus(`Render error on card ${i + 1}: ${err.message}`, 'error'); return; }
    if (!canvas) continue;
    const bytes = await canvasToPngBytes(canvas);
    disposeCanvas(canvas);
    if (!bytes) continue;
    const name = uniqueFileName(cardFileName(all[i], i), usedNames);
    files.push({ name: `${name}.png`, data: bytes });
  }
  if (!files.length) return;

  const zipBlob = createZipBlob(files);
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.download = 'decklist-cards.zip';
  a.href = url;
  a.click();
  URL.revokeObjectURL(url);
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

// Non-blocking validation/error line inside a modal footer — replaces alert(),
// which would otherwise sit behind the modal-overlay z-index and never be seen.
function setModalStatus(el, msg, type = '') {
  el.textContent = msg;
  el.className   = 'modal-status' + (type ? ` ${type}` : '');
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
  let src;
  try { src = await renderFullRes(index); }
  catch (err) { setStatus(`Render error: ${err.message}`, 'error'); return; }
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
const editModalStatus     = document.getElementById('editModalStatus');
const editTitleInput      = document.getElementById('editTitle');
const editAutoSort        = document.getElementById('editAutoSort');
const editCardTables      = document.getElementById('editCardTables');
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
const editColorSwap       = document.getElementById('editColorSwap');
const editBlendGroup      = document.getElementById('editBlendGroup');
const editBlendSlider     = document.getElementById('editBlendSlider');
const editBlendValue      = document.getElementById('editBlendValue');
const editArtTransform     = document.getElementById('editArtTransform');
const editArtZoom          = document.getElementById('editArtZoom');
const editArtTransformReset = document.getElementById('editArtTransformReset');
let   editingIndex = -1;

const MODAL_ART_STYLES = new Set(['art-bg', 'cover']);

// Guards the one-off art-preview resolve in openEdit against a slow resolve
// from a previously-opened card landing after a newer card is already open.
let _artPreviewSeq = 0;

// ── COLOR OVERRIDE (edit modal) ───────────────────────────────────────────────
// Modal-local working copy of the per-card colorOverride: null = auto, otherwise
// an array of letters from W/U/B/R/G (or including 'C' for a colorless blend,
// e.g. ['C','W']), IN CLICK ORDER — order is significant: buildDeckModel reads
// override[0]/[1] as primary/secondary, so ['W','B'] and ['B','W'] pick
// opposite frame/watermark sides for the same WB identity. Seeded in openEdit,
// mutated by the toggle buttons and the swap button, persisted on save.
let editColorOverride = null;

// Sync the toggle buttons' pressed state (and order badge) to editColorOverride.
function syncColorToggles() {
  const active = new Set(editColorOverride ?? []);
  const showOrder = (editColorOverride ?? []).length === 2;
  for (const btn of editColorToggles.querySelectorAll('.color-toggle')) {
    const on = btn.dataset.color === 'auto'
      ? editColorOverride === null
      : active.has(btn.dataset.color);
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
    if (showOrder && on && btn.dataset.color !== 'auto') {
      btn.dataset.order = String(editColorOverride.indexOf(btn.dataset.color) + 1);
    } else {
      delete btn.dataset.order;
    }
  }
  editColorSwap.style.display = showOrder ? '' : 'none';
}

// Toggle one color letter (or reset to auto). 'C' combines with at most one
// other WUBRG letter (a colorless blend, e.g. ['C','W']); a third color drops
// 'C' since 3+ colors always collapse to a single gold frame anyway. Selecting
// nothing collapses back to auto (null).
function toggleColor(color) {
  if (color === 'auto') { editColorOverride = null; return; }
  let cur = editColorOverride ? [...editColorOverride] : [];
  if (color === 'C') {
    if (cur.includes('C'))    cur = cur.filter(c => c !== 'C');
    else if (cur.length <= 1) cur = [...cur, 'C'];
    else                      cur = ['C'];
  } else if (cur.includes(color)) {
    cur = cur.filter(c => c !== color);
  } else {
    const wubrgCount = cur.filter(c => c !== 'C').length;
    cur = (wubrgCount >= 1 && cur.includes('C'))
      ? [...cur.filter(c => c !== 'C'), color]   // 2nd WUBRG color alongside C drops C
      : [...cur, color];
  }
  editColorOverride = cur.length ? cur : null;
}

// Colors selected right now, for gating the blend slider: the override's own
// length when manual, otherwise the deck's last-known auto-detected count.
function currentColorCount(entry) {
  if (editColorOverride) return editColorOverride.length;
  return entry?.model?.colorIdentity?.length ?? 0;
}

function updateBlendVisibility(styleKey, colorCount) {
  editBlendGroup.style.display =
    MODAL_BLEND_STYLES.has(styleKey) && colorCount === 2 ? '' : 'none';
}

editColorToggles.addEventListener('click', e => {
  const btn = e.target.closest('.color-toggle');
  if (!btn) return;
  toggleColor(btn.dataset.color);
  syncColorToggles();
  const entry = getState(editingIndex);
  if (entry) updateBlendVisibility(entry.styleKey ?? 'm15', currentColorCount(entry));
  scheduleCardPreview();
});

editColorSwap.addEventListener('click', () => {
  if (!editColorOverride || editColorOverride.length !== 2) return;
  editColorOverride = [editColorOverride[1], editColorOverride[0]];
  syncColorToggles();
  scheduleCardPreview();
});

// ── COLOR BLEND SLIDER (edit modal) ───────────────────────────────────────────
// Styles where the two-color blend slider is meaningful (m15/m15-2col frame/
// watermark split is the primary effect of splitRatio — both share the same
// drawFrames/drawWatermark in m15-shared.js).
const MODAL_BLEND_STYLES = new Set(['m15', 'm15-2col']);

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
  _artPreviewSeq++;                  // cancel any in-flight art-swatch resolve
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

// ── PER-CARD TABLE EDITING ────────────────────────────────────────────────────
// Replaces the old free-text textarea: one table per TYPE_ORDER bucket, each
// row a real object carried through the whole editing session (so e.g. a
// card's `art` just stays attached unless the row itself is removed — no more
// text round-trip + name-matching to recover it). _editRows is the working
// copy; nothing is written back to state.js until Re-render is clicked.

let _editRows   = [];   // [{ rowId, type, count, name, cost, rarity, art }]
let _editRowSeq = 0;

function rowsForType(type) {
  return _editRows.filter(r => r.type === type);
}

// Seeds _editRows from a deck's flat card list, grouping duplicates into one
// row per unique name (like the old manual-text format did). Sorted per
// ROW_COMPARE_BY_TYPE/rarity when autoSort !== false; otherwise the deck's
// own existing card order is preserved as-is.
function buildEditRowsFromDeck(deck, autoSort) {
  const typeGroups = groupByType(deck.cards);
  const rows = [];
  for (const type of TYPE_ORDER) {
    const cards = typeGroups[type];
    if (!cards) continue;
    const compare = autoSort === false ? null : ROW_COMPARE_BY_TYPE[type];
    for (const { card, count } of groupDuplicates(cards, compare)) {
      rows.push({ rowId: ++_editRowSeq, type, count, name: card.name, cost: card.cost, rarity: card.rarity, art: card.art ?? null });
    }
  }
  return rows;
}

// Re-sorts one type's rows using the exact comparator buildDeckModel would
// apply with autoSort left on — used when the "Auto sort" checkbox is
// re-checked, so what's on screen matches what Re-render will produce.
// (Not groupDuplicates: that also merges same-named rows, which would be a
// surprising side effect of just clicking a sort checkbox.)
function resortRowsForType(type) {
  const compare = ROW_COMPARE_BY_TYPE[type] ?? compareByRarity;
  return rowsForType(type)
    .map(row => ({ card: row, count: row.count }))
    .sort(compare)
    .map(({ card }) => card);
}

function resortAllEditRows() {
  _editRows = TYPE_ORDER.flatMap(resortRowsForType);
}

// Flattens _editRows back into a real deck.cards list (count copies each,
// colors re-derived from the cost field exactly like the old manual-format
// parser did) plus the title field. Shared by the live preview and Save.
function buildDeckFromEditRows() {
  const cards = [];
  for (const row of _editRows) {
    const colors = colorsFromCost(row.cost ?? '');
    for (let i = 0; i < row.count; i++) {
      cards.push({ name: row.name, type: row.type, rarity: row.rarity, cost: row.cost ?? '', colors: [...colors], art: row.art ?? null });
    }
  }
  return { name: editTitleInput.value.trim() || 'Deck', cards };
}

// Drag-and-drop: a row's handle carries its rowId; dropping onto another row
// (same or different type table) splices it to that position and adopts the
// target's type. Dropping directly on a table (not a row — including an
// empty table) appends to the end of that type instead (wired per-table in
// renderEditCardTables). Either path uncheck "Auto sort" — an explicit
// re-order is exactly the "this" the checkbox exists to reflect.
function moveEditRowBeforeTarget(draggedId, targetId, targetType) {
  const fromIdx = _editRows.findIndex(r => r.rowId === draggedId);
  if (fromIdx < 0) return;
  const [moved] = _editRows.splice(fromIdx, 1);
  moved.type = targetType;
  let toIdx = _editRows.findIndex(r => r.rowId === targetId);
  if (toIdx < 0) toIdx = _editRows.length;
  _editRows.splice(toIdx, 0, moved);
}

function moveEditRowToEndOfType(draggedId, targetType) {
  const fromIdx = _editRows.findIndex(r => r.rowId === draggedId);
  if (fromIdx < 0) return;
  const [moved] = _editRows.splice(fromIdx, 1);
  moved.type = targetType;
  _editRows.push(moved);
}

function afterEditRowsReordered() {
  editAutoSort.checked = false;
  renderEditCardTables();
  scheduleCardPreview();
}

function wireEditRowDrag(tr, handle, row) {
  handle.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', String(row.rowId));
    e.dataTransfer.effectAllowed = 'move';
    tr.classList.add('edit-card-row--dragging');
  });
  handle.addEventListener('dragend', () => tr.classList.remove('edit-card-row--dragging'));

  // Same-table reorder only — cross-table moves stay drag-only, matching the
  // main grid's reorder handle (cards-ui.js addCardOverlay) which is also
  // keyboard-operable only within its one list.
  handle.addEventListener('keydown', e => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const siblings = rowsForType(row.type);
    const idx = siblings.findIndex(r => r.rowId === row.rowId);
    const targetIdx = idx + (e.key === 'ArrowUp' ? -1 : 1);
    if (targetIdx < 0 || targetIdx >= siblings.length) return;
    if (targetIdx === siblings.length - 1 && idx < targetIdx) {
      moveEditRowToEndOfType(row.rowId, row.type);
    } else {
      moveEditRowBeforeTarget(row.rowId, siblings[targetIdx].rowId, row.type);
    }
    afterEditRowsReordered();
    editCardTables.querySelector(`[data-row-id="${row.rowId}"] .edit-card-handle`)?.focus();
  });

  tr.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
  tr.addEventListener('drop', e => {
    e.preventDefault();
    e.stopPropagation();   // don't also trigger the table's append-to-end drop handler
    const draggedId = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (Number.isNaN(draggedId) || draggedId === row.rowId) return;
    moveEditRowBeforeTarget(draggedId, row.rowId, row.type);
    afterEditRowsReordered();
  });
}

function buildEditRowEl(row) {
  const tr = document.createElement('tr');
  tr.className = 'edit-card-row';
  tr.dataset.rowId = String(row.rowId);

  const handleTd = document.createElement('td');
  handleTd.className = 'edit-card-handle-cell';
  const handle = document.createElement('span');
  handle.className = 'card-drag-handle edit-card-handle';
  handle.title = 'Drag to reorder or move to another table (or focus and press ↑ / ↓)';
  handle.setAttribute('aria-label', 'Reorder or move card. Drag, or use up and down arrow keys.');
  handle.setAttribute('role', 'button');
  handle.tabIndex = 0;
  handle.textContent = '⠿';
  handle.draggable = true;
  handleTd.appendChild(handle);

  const countTd = document.createElement('td');
  const countInput = document.createElement('input');
  countInput.type = 'number'; countInput.min = '1'; countInput.className = 'edit-card-count';
  countInput.value = String(row.count);
  countInput.setAttribute('aria-label', 'Count');
  countTd.appendChild(countInput);

  const nameTd = document.createElement('td');
  const nameInput = document.createElement('input');
  nameInput.type = 'text'; nameInput.className = 'edit-card-name';
  nameInput.value = row.name;
  nameInput.setAttribute('aria-label', 'Card name');
  nameTd.appendChild(nameInput);

  const costTd = document.createElement('td');
  const costInput = document.createElement('input');
  costInput.type = 'text'; costInput.className = 'edit-card-cost';
  costInput.placeholder = '{2}{w}{w}';
  costInput.value = row.cost ?? '';
  costInput.setAttribute('aria-label', 'Mana cost');
  costTd.appendChild(costInput);

  const rarityTd = document.createElement('td');
  const raritySel = document.createElement('select');
  raritySel.className = 'edit-card-rarity';
  raritySel.setAttribute('aria-label', 'Rarity');
  for (const r of RARITY_ORDER) {
    const opt = document.createElement('option');
    opt.value = r; opt.textContent = r[0].toUpperCase() + r.slice(1);
    if (r === row.rarity) opt.selected = true;
    raritySel.appendChild(opt);
  }
  rarityTd.appendChild(raritySel);

  const removeTd = document.createElement('td');
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button'; removeBtn.className = 'edit-card-remove';
  removeBtn.title = 'Remove card'; removeBtn.setAttribute('aria-label', `Remove ${row.name}`);
  removeBtn.textContent = '✕';
  removeTd.appendChild(removeBtn);

  tr.append(handleTd, countTd, nameTd, costTd, rarityTd, removeTd);

  countInput.addEventListener('input', () => {
    row.count = Math.max(1, parseInt(countInput.value, 10) || 1);
    scheduleCardPreview();
  });
  nameInput.addEventListener('input', () => { row.name = nameInput.value; scheduleCardPreview(); });
  costInput.addEventListener('input', () => { row.cost = costInput.value; scheduleCardPreview(); });
  raritySel.addEventListener('change', () => { row.rarity = raritySel.value; scheduleCardPreview(); });
  removeBtn.addEventListener('click', () => {
    _editRows = _editRows.filter(r => r.rowId !== row.rowId);
    renderEditCardTables();
    scheduleCardPreview();
  });

  wireEditRowDrag(tr, handle, row);
  return tr;
}

// Name-only "add a card" row at the bottom of each type table. Resolves cost/
// rarity/art via Scryfall (same enrichCardsFromScryfall Manual-mode Generate
// uses) but — per the user's call — a lookup miss still adds the row (blank
// cost/rarity/art) instead of rejecting it, so it can be filled in by hand.
function buildAddCardRow(type) {
  const tr = document.createElement('tr');
  tr.className = 'edit-card-addrow';
  const td = document.createElement('td');
  td.colSpan = 6;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'edit-card-add-input';
  input.placeholder = 'Add card by name…';
  input.setAttribute('aria-label', `Add card to ${type}`);
  td.appendChild(input);
  tr.appendChild(td);

  let committing = false;
  const commit = async () => {
    const name = input.value.trim();
    if (!name || committing) return;
    committing = true;
    setModalStatus(editModalStatus, `Looking up "${name}"…`, 'loading');
    let rowData = { name, cost: '', rarity: 'common', art: null };
    try {
      const { cards, notFound } = await enrichCardsFromScryfall([{ name, count: 1 }]);
      if (cards.length) {
        rowData = { name: cards[0].name, cost: cards[0].cost, rarity: cards[0].rarity, art: cards[0].art };
        setModalStatus(editModalStatus, '');
      } else if (notFound.length) {
        setModalStatus(editModalStatus, `"${name}" not found on Scryfall — fill in cost/rarity/art manually.`, 'error');
      }
    } catch (err) {
      setModalStatus(editModalStatus, `Scryfall lookup failed: ${err.message} — fill in details manually.`, 'error');
    }
    _editRows.push({ rowId: ++_editRowSeq, type, count: 1, ...rowData });
    committing = false;
    renderEditCardTables();
    scheduleCardPreview();
  };

  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
  input.addEventListener('blur', commit);

  return tr;
}

function renderEditCardTables() {
  editCardTables.innerHTML = '';
  for (const type of TYPE_ORDER) {
    const rows = rowsForType(type);

    const section = document.createElement('div');
    section.className = 'edit-card-table-section';
    const heading = document.createElement('div');
    heading.className = 'edit-card-table-heading';
    heading.textContent = type;
    section.appendChild(heading);

    const table = document.createElement('table');
    table.className = 'edit-card-table';
    const tbody = document.createElement('tbody');

    if (!rows.length) {
      const emptyRow = document.createElement('tr');
      emptyRow.className = 'edit-card-empty-row';
      const td = document.createElement('td');
      td.colSpan = 6;
      td.textContent = 'No cards';
      emptyRow.appendChild(td);
      tbody.appendChild(emptyRow);
    }
    for (const row of rows) tbody.appendChild(buildEditRowEl(row));
    tbody.appendChild(buildAddCardRow(type));

    // Fallback drop target for this type: dropping anywhere in the tbody that
    // isn't on a specific row (including when it's empty) appends to the end.
    tbody.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    tbody.addEventListener('drop', e => {
      e.preventDefault();
      const draggedId = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (Number.isNaN(draggedId)) return;
      moveEditRowToEndOfType(draggedId, type);
      afterEditRowsReordered();
    });

    table.appendChild(tbody);
    section.appendChild(table);
    editCardTables.appendChild(section);
  }
}

editAutoSort.addEventListener('change', () => {
  if (editAutoSort.checked) {
    resortAllEditRows();
    renderEditCardTables();
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

  const deck = buildDeckFromEditRows();
  if (!deck.cards.length) return null;

  if (styleKey === 'cover') {
    const subtitle = editSubtitleInput.value.trim();
    deck.name = mergeTitleSubtitle(deck.name, subtitle);
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
      autoSort: editAutoSort.checked,
    }),
    styleKey,
  };
}

async function renderCardPreview() {
  const seq = ++_cardPreviewSeq;
  let built;
  try { built = await buildPreviewModel(); } catch { return; }
  if (!built || seq !== _cardPreviewSeq) return;   // bad input or superseded

  // Deck-text edits can change the auto-detected color count (colorOverride
  // null) without a toggle click, so re-sync the blend slider's visibility
  // here too — the toggle handler already does this synchronously for clicks.
  updateBlendVisibility(built.styleKey, built.model.colorIdentity.length);

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
// title, subtitle, and the art URL (per-card table fields wire scheduleCardPreview
// themselves in buildEditRowEl/buildAddCardRow). Art-thumbnail clicks (deck grid +
// Scryfall search) call scheduleCardPreview from their own handlers in
// buildArtThumb. The watermark is not editable inside the modal.
editTitleInput.addEventListener('input', scheduleCardPreview);
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
  if (editingIndex < 0) return;

  setModalStatus(editModalStatus, '');
  const deck = buildDeckFromEditRows();
  if (!deck.cards.length) { setModalStatus(editModalStatus, 'No cards — add at least one.', 'error'); return; }

  const entry     = getState(editingIndex);
  const styleKey  = entry?.styleKey ?? 'm15';

  // Merge subtitle back into deck name (cover style only)
  if (styleKey === 'cover') {
    const subtitle = editSubtitleInput.value.trim();
    deck.name = mergeTitleSubtitle(deck.name, subtitle);
  }

  const patch = { deck, colorOverride: editColorOverride, autoSort: editAutoSort.checked };
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
    setModalStatus(editModalStatus, `Render error: ${err.message}`, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Re-render';
  }
});

function openEdit(index) {
  const entry = getState(index);
  if (!entry) return;

  _returnFocus = document.activeElement;
  setModalStatus(editModalStatus, '');
  const styleKey = entry.styleKey ?? 'm15';

  // Title always shown; subtitle only for the cover style — both split out of
  // the "Title | Subtitle" deck name.
  const { title, subtitle } = splitTitleSubtitle(entry.deck.name);
  editTitleInput.value = title;
  const isCover = styleKey === 'cover';
  editSubtitleGroup.style.display = isCover ? '' : 'none';
  if (isCover) {
    editSubtitleInput.value = subtitle;
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
    const artPreviewSeq = ++_artPreviewSeq;
    resolveArtUrl(artVal || entry.model?.artUrl || '').then(resolved => {
      if (artPreviewSeq === _artPreviewSeq) setArtPreview(resolved);
    });
  }

  editingIndex = index;            // seedBlendSlider + preview read the current entry

  // Color override: applies to every style (drives pips/gradients/frame).
  editColorOverride = Array.isArray(entry.colorOverride) && entry.colorOverride.length
    ? [...entry.colorOverride]
    : null;
  syncColorToggles();

  // Blend slider: m15 only, and only meaningful for an exactly-two-color pack.
  // Seed from the saved override, or the deck's computed auto split when
  // there's none.
  updateBlendVisibility(styleKey, currentColorCount(entry));
  const hasBlend = editBlendGroup.style.display !== 'none';
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

  editAutoSort.checked = entry.autoSort !== false;
  _editRows = buildEditRowsFromDeck(entry.deck, entry.autoSort);
  renderEditCardTables();

  editModal.style.display = 'flex';
  editTitleInput.focus();
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
  const { title: rawTitle, subtitle: rawSubtitle } = splitTitleSubtitle(entry.deck.name);

  const box = document.createElement('div');
  box.className = 'inline-title-edit';

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'inline-title-input';
  titleInput.value = rawTitle;
  titleInput.setAttribute('aria-label', 'Card title');
  box.appendChild(titleInput);

  let subInput = null;
  if (isCover) {
    subInput = document.createElement('input');
    subInput.type = 'text';
    subInput.className = 'inline-title-input';
    subInput.placeholder = 'Subtitle';
    subInput.value = rawSubtitle;
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
    const name  = mergeTitleSubtitle(title, sub);
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

  // Drag handle (reorder the card grid). Also keyboard-operable: focus the
  // handle and press ←/→ to move the card, since dragstart/drop alone leave
  // keyboard-only users with no way to reorder at all.
  const handle = document.createElement('div');
  handle.className = 'card-drag-handle';
  handle.title = 'Drag to reorder (or focus and press ← / →)';
  handle.setAttribute('aria-label', 'Reorder card. Drag, or use left and right arrow keys.');
  handle.setAttribute('role', 'button');
  handle.tabIndex = 0;
  handle.textContent = '⠿';
  handle.draggable = true;
  handle.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', String(idxOf()));
    e.dataTransfer.effectAllowed = 'move';
    cell.classList.add('card-cell--dragging');
  });
  handle.addEventListener('dragend', () => cell.classList.remove('card-cell--dragging'));
  handle.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const from = idxOf();
    const to = from + (e.key === 'ArrowLeft' ? -1 : 1);
    if (to < 0 || to >= getAllState().length) return;
    reorderCards(from, to);
    handle.focus();   // re-append during reorder can drop focus — restore it
  });
  overlay.appendChild(handle);

  // Per-card style selector (overrides the global style for this card only)
  const styleSel = document.createElement('select');
  styleSel.className = 'card-wm-select card-style-select';
  styleSel.title = 'Style';
  styleSel.setAttribute('aria-label', 'Style');
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
  wmSel.setAttribute('aria-label', 'Watermark');
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
const batchEditModalStatus = document.getElementById('batchEditModalStatus');
const batchEditTbody = document.getElementById('batchEditTbody');

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
  _returnFocus = document.activeElement;
  setModalStatus(batchEditModalStatus, '');
  batchEditTbody.innerHTML = '';
  for (const entry of entries) batchEditTbody.appendChild(buildBatchRow(entry));
  batchEditModal.style.display = 'flex';
  batchEditTbody.querySelector('input')?.focus();
}

function closeBatchEdit() {
  batchEditModal.style.display = 'none';
  restoreFocus();
}

document.getElementById('batchEditClose').addEventListener('click', closeBatchEdit);
document.getElementById('batchEditCancelBtn').addEventListener('click', closeBatchEdit);
batchEditModal.addEventListener('click', e => { if (e.target === batchEditModal) closeBatchEdit(); });
batchEditModal.addEventListener('keydown', e => trapFocus(batchEditModal, e));

document.getElementById('batchEditSaveBtn').addEventListener('click', async () => {
  const saveBtn = document.getElementById('batchEditSaveBtn');
  setModalStatus(batchEditModalStatus, '');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Rendering…';
  try {
    const rows = [...batchEditTbody.children];
    const toRender = [];
    const blanked = [];
    rows.forEach((row, i) => {
      const entry = getState(i);
      if (!entry) return;
      const title    = row.querySelector('.title-input').value.trim();
      const subtitle = row.querySelector('.subtitle-input').value.trim();
      // Don't silently rename a blanked title to "Deck" — that can rewrite
      // several cards at once from one accidental select-all-delete. Leave
      // it unchanged and tell the user instead.
      if (!title) { blanked.push(i + 1); return; }
      const newName  = mergeTitleSubtitle(title, subtitle);
      if (newName !== entry.deck.name) {
        updateState(i, { deck: { ...entry.deck, name: newName } });
        toRender.push(i);
      }
    });
    await Promise.all(toRender.map(i => renderOneCell(i)));
    if (blanked.length) {
      // Leave the modal open so the message (and the still-blank rows) stay
      // visible instead of vanishing the instant the modal closes.
      setModalStatus(batchEditModalStatus,
        `Row${blanked.length > 1 ? 's' : ''} ${blanked.join(', ')} left unchanged — title can't be blank.`,
        'error');
    } else {
      closeBatchEdit();
    }
  } catch (err) {
    setModalStatus(batchEditModalStatus, `Render error: ${err.message}`, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Apply & Re-render';
  }
});
