// ── CARD UI: CELLS, OVERLAYS, MODALS, DOWNLOAD ──────────────────────────────
// Owns: per-card cell creation, overlay buttons, fullscreen + edit modals,
// per-card watermark selector, single + batch PNG download, downsample helper.

import { get as registryGet, list as registryList } from './render/registry.js';
import { buildDeckModel }      from './deck-model.js?v=2';
import { getWatermarks }       from './watermarks.js?v=2';
import { parseManualDeck, deckToManualText, decksToYaml, resolveArtUrl, searchScryfallArt } from './cube-source.js?v=33';
import {
  clear as clearState, push as pushState,
  get as getState, update as updateState, getAll as getAllState,
} from './state.js';

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
  const model = buildDeckModel(entry.deck, entry.wmKey, artOverride);
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

export async function renderDecks(decks, wmKey, styleKey = 'm15', artOverride = '') {
  const grid = document.getElementById('cardGrid');
  grid.innerHTML = '';
  clearState();

  // styleKey/artOverride are stored per-cell below; renderFullRes resolves the
  // renderer from each cell's state, so no shared renderer ref is needed here.

  // Create all cells first so the DOM populates immediately.
  // Only the lightweight display canvas lives in the DOM during viewing;
  // full-res print canvases are materialized on demand (print/download).
  const cells = decks.map((deck, i) => {
    const cell = document.createElement('div');
    cell.className = 'card-cell';

    const screenC = document.createElement('canvas');
    screenC.className = 'card card--screen';
    cell.appendChild(screenC);

    pushState({ deck, wmKey, styleKey, artOverride, model: null, cell });
    addCardOverlay(cell, i);
    return cell;
  });
  grid.append(...cells);

  // Render all cards concurrently, each into a throwaway full-res canvas.
  await Promise.all(decks.map(async (deck, i) => {
    const resolvedArt = await resolveArtUrl(artOverride);
    updateState(i, { model: buildDeckModel(deck, wmKey, resolvedArt) });
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
  const decks = getAllState().map(e => e.deck);
  if (!decks.length) return;
  const blob = new Blob([decksToYaml(decks)], { type: 'text/yaml' });
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
let   editingIndex = -1;

const MODAL_ART_STYLES = new Set(['art-bg', 'cover']);

function closeEdit() {
  if (editModal.style.display === 'none') return;
  editModal.style.display = 'none';
  _cardPreviewSeq++;                 // cancel any in-flight preview render
  clearTimeout(_cardPreviewTimer);
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

function buildArtThumb(artUrl, name, isSelected) {
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
  div.addEventListener('click', () => {
    document.querySelectorAll('.art-picker-thumb.selected').forEach(t => t.classList.remove('selected'));
    div.classList.add('selected');
    editArtUrlInput.value = artUrl;
    setArtPreview(artUrl);
    scheduleCardPreview();
  });
  return div;
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
    artPickerGrid.appendChild(buildArtThumb(artUrl, name, artUrl === currentArt));
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
  if (MODAL_ART_STYLES.has(styleKey)) {
    artOverride = await resolveArtUrl(editArtUrlInput.value.trim());
  }

  return { model: buildDeckModel(deck, entry.wmKey, artOverride), styleKey };
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
  clearTimeout(_cardPreviewTimer);
  _cardPreviewTimer = setTimeout(renderCardPreview, 300);
}

// Every editable input that feeds buildPreviewModel re-renders the preview:
// deck text (incl. the title line), subtitle, and the art URL. Art-thumbnail
// clicks (deck grid + Scryfall search) call scheduleCardPreview from their own
// handlers in buildArtThumb. The watermark is not editable inside the modal.
editTextarea.addEventListener('input', scheduleCardPreview);
editSubtitleInput.addEventListener('input', scheduleCardPreview);

document.getElementById('editSaveBtn').addEventListener('click', async () => {
  const text = editTextarea.value.trim();
  if (!text || editingIndex < 0) return;

  const parsed = parseManualDeck(text);
  if (!parsed.length) { alert('No cards found — check the format.'); return; }

  const deck      = parsed[0];
  const entry     = getState(editingIndex);
  const styleKey  = entry?.styleKey ?? 'm15';

  // Merge subtitle back into deck name (cover style only)
  if (styleKey === 'cover') {
    const subtitle = editSubtitleInput.value.trim();
    const baseTitle = deck.name.split('|')[0].trim();
    deck.name = subtitle ? `${baseTitle} | ${subtitle}` : baseTitle;
  }

  const patch = { deck };
  if (MODAL_ART_STYLES.has(styleKey)) {
    patch.artOverride = editArtUrlInput.value.trim();
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
    resolveArtUrl(artVal).then(setArtPreview);
  }

  editTextarea.value = deckToManualText(entry.deck);
  editingIndex = index;
  editModal.style.display = 'flex';
  editTextarea.focus();
  renderCardPreview();   // seed the live preview with the current card
}

// ── ESC TO CLOSE MODALS ───────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeFullscreen();
    if (editModal.style.display !== 'none') closeEdit();
  }
});

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

  btnRow.querySelector('.btn-fullscreen').addEventListener('click', () => openFullscreen(index));
  btnRow.querySelector('.btn-download').addEventListener('click',   () => downloadCell(index));
  btnRow.querySelector('.btn-edit').addEventListener('click',       () => openEdit(index));

  styleSel.addEventListener('change', async () => {
    updateState(index, { styleKey: styleSel.value });
    styleSel.disabled = true;
    try { await renderOneCell(index); } finally { styleSel.disabled = false; }
  });

  wmSel.addEventListener('change', async () => {
    updateState(index, { wmKey: wmSel.value });
    wmSel.disabled = true;
    try { await renderOneCell(index); } finally { wmSel.disabled = false; }
  });
}
