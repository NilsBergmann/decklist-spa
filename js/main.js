// ── ENTRY POINT ──────────────────────────────────────────────────────────────
// Wires the control panel; delegates rendering to cards-ui.js.
// Side-effect import of m15.js registers the renderer before any render call.

import './render/m15.js?v=8';          // registers m15 renderer
import './render/m15-2col.js?v=8';     // registers m15 2-column renderer
import './render/art-bg.js?v=7';       // registers art-background renderer
import './render/cover.js?v=2';        // registers cover-card renderer

import { list as listRenderers }  from './render/registry.js?v=1';
import { getWatermarks, loadWatermarkSets } from './watermarks.js?v=3';
import {
  extractCubeId, fetchCubeData, parseDecks,
  listCachedIds, parseManualDeck, parseDeckYaml,
} from './cube-source.js?v=36';
import { renderDecks, downloadAll, downloadDecksYaml, rerenderAll, materializePrintCanvases, openBatchEdit, hasCards } from './cards-ui.js?v=55';
import { setStatus } from './status.js?v=1';

// ── DOM REFERENCES ────────────────────────────────────────────────────────────

const generateBtn    = document.getElementById('generateBtn');
const printBtn       = document.getElementById('printBtn');
const downloadBtn    = document.getElementById('downloadBtn');
const batchEditBtn   = document.getElementById('batchEditBtn');
const exportYamlBtn  = document.getElementById('exportYamlBtn');
const importYamlBtn  = document.getElementById('importYamlBtn');
const importYamlInput = document.getElementById('importYamlInput');
const cacheSelect    = document.getElementById('cacheSelect');
const cacheLoadBtn   = document.getElementById('cacheLoadBtn');
const cacheDeleteBtn = document.getElementById('cacheDeleteBtn');

// ── SETTINGS PERSISTENCE ──────────────────────────────────────────────────────
// Remember the user's style / watermark / page-size / crop-marks choices across
// reloads. Restored after the dropdowns are populated (see below).

const SETTINGS_KEY = 'decklist:settings';

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {}; }
  catch { return {}; }
}

function saveSettings(patch) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...loadSettings(), ...patch }));
  } catch {}
}

// ── WATERMARK DROPDOWN ────────────────────────────────────────────────────────

const wmSelect = document.getElementById('watermark');
function buildWatermarkOptions(selected = 'fdn') {
  wmSelect.innerHTML = Object.entries(getWatermarks())
    .map(([k, v]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${v.label}</option>`)
    .join('');
  // If the desired value isn't present, fall back to the always-available auto option.
  if (![...wmSelect.options].some(o => o.value === selected)) wmSelect.value = 'set-color';
}
buildWatermarkOptions();

// Refresh the set list from Scryfall (cached); rebuild preserving the selection.
loadWatermarkSets().then(() => buildWatermarkOptions(wmSelect.value));

// ── STYLE DROPDOWN (B3) ───────────────────────────────────────────────────────

const styleSelect = document.getElementById('styleSelect');
const artUrlGroup = document.getElementById('artUrlGroup');
styleSelect.innerHTML = listRenderers()
  .map(r => `<option value="${r.key}"${r.key === 'm15' ? ' selected' : ''}>${r.label}</option>`)
  .join('');

// Auto-rerender: re-render all generated cards when a render-affecting option
// changes. Calls are serialized so rapid toggles don't race on the canvases.
let renderChain = Promise.resolve();
function queueRerender(patch) {
  renderChain = renderChain.then(() => rerenderAll(patch)).catch(() => {});
}

// Changing style/watermark after cards exist overwrites every card's current
// look (including per-card overrides) with no undo — confirm before applying,
// reverting the dropdown if the user backs out. The pre-change value is
// captured on focus (right before the user opens the dropdown), so it stays
// correct across programmatic value changes (restoreSettings, loadWatermarkSets)
// without needing to be manually re-synced after each of them.
let styleValueBeforeFocus = styleSelect.value;
let wmValueBeforeFocus    = wmSelect.value;
styleSelect.addEventListener('focus', () => { styleValueBeforeFocus = styleSelect.value; });
wmSelect.addEventListener('focus',    () => { wmValueBeforeFocus    = wmSelect.value; });

function confirmDestructiveChange(select, previousValue, label) {
  if (!hasCards()) return true;
  if (confirm(`Change ${label} for every generated card? This can't be undone.`)) return true;
  select.value = previousValue;
  return false;
}

const ART_STYLES = new Set(['art-bg', 'cover']);
styleSelect.addEventListener('change', () => {
  if (!confirmDestructiveChange(styleSelect, styleValueBeforeFocus, 'the style')) return;
  styleValueBeforeFocus = styleSelect.value;
  artUrlGroup.style.display = ART_STYLES.has(styleSelect.value) ? '' : 'none';
  saveSettings({ style: styleSelect.value });
  queueRerender({ styleKey: styleSelect.value });
});
wmSelect.addEventListener('change', () => {
  if (!confirmDestructiveChange(wmSelect, wmValueBeforeFocus, 'the watermark')) return;
  wmValueBeforeFocus = wmSelect.value;
  saveSettings({ watermark: wmSelect.value });
  queueRerender({ wmKey: wmSelect.value });
});
document.getElementById('artUrl')
  .addEventListener('change', e => queueRerender({ artOverride: e.target.value.trim() }));

// ── INPUT-MODE TABS ───────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const mode = btn.dataset.mode;
    document.getElementById('modeCubecobra').style.display = mode === 'cubecobra' ? '' : 'none';
    document.getElementById('modeManual').style.display    = mode === 'manual'    ? '' : 'none';
  });
});

// ── CUBE CACHE DROPDOWN ───────────────────────────────────────────────────────

function refreshCacheDropdown() {
  const ids   = listCachedIds();
  const group = document.getElementById('cacheGroup');
  group.style.display = ids.length ? '' : 'none';
  cacheSelect.innerHTML = ids.map(id => `<option value="${id}">${id}</option>`).join('');
}

function loadCacheSelection() {
  const id = cacheSelect.value;
  if (id) document.getElementById('cubeId').value = id;
}

cacheLoadBtn.addEventListener('click', loadCacheSelection);
cacheSelect.addEventListener('change', loadCacheSelection);

cacheDeleteBtn.addEventListener('click', () => {
  const id = cacheSelect.value;
  if (!id) return;
  if (!confirm(`Remove the cached cube "${id}"? This can't be undone.`)) return;
  localStorage.removeItem(`cube:${id}`);
  refreshCacheDropdown();
  setStatus(`Removed cache for "${id}".`);
});

refreshCacheDropdown();
loadCacheSelection();   // pre-fill cubeId with first cached entry if any

// ── PAGE SETTINGS ─────────────────────────────────────────────────────────────

function applyPageSettings() {
  const pageSize  = document.getElementById('pageSize').value;
  const cropMarks = document.getElementById('cropMarks').checked;

  document.body.classList.toggle('letter',     pageSize === 'letter');
  document.body.classList.toggle('crop-marks', cropMarks);

  let el = document.getElementById('dynamic-page-style');
  if (!el) {
    el = document.createElement('style');
    el.id = 'dynamic-page-style';
    document.head.appendChild(el);
  }
  el.textContent = pageSize === 'letter'
    ? '@page { size: letter portrait; margin: 0; }'
    : '@page { size: A4 portrait; margin: 0; }';
}

// Page size + crop marks only affect print/layout CSS — apply live, no re-render.
const pageSizeEl  = document.getElementById('pageSize');
const cropMarksEl = document.getElementById('cropMarks');
pageSizeEl.addEventListener('change', () => {
  saveSettings({ pageSize: pageSizeEl.value });
  applyPageSettings();
});
cropMarksEl.addEventListener('change', () => {
  saveSettings({ cropMarks: cropMarksEl.checked });
  applyPageSettings();
});

// ── RESTORE SAVED SETTINGS ────────────────────────────────────────────────────
// Apply persisted choices now that every control + applyPageSettings exists.
// Only restore a value when its option still exists (renderers/sets can change).
(function restoreSettings() {
  const s = loadSettings();
  if (s.style && [...styleSelect.options].some(o => o.value === s.style)) {
    styleSelect.value = s.style;
  }
  if (s.watermark && [...wmSelect.options].some(o => o.value === s.watermark)) {
    wmSelect.value = s.watermark;
  }
  if (s.pageSize) pageSizeEl.value = s.pageSize;
  if (typeof s.cropMarks === 'boolean') cropMarksEl.checked = s.cropMarks;

  artUrlGroup.style.display = ART_STYLES.has(styleSelect.value) ? '' : 'none';
  applyPageSettings();
})();

// ── GENERATE ──────────────────────────────────────────────────────────────────

generateBtn.addEventListener('click', async () => {
  const mode     = document.querySelector('.tab.active')?.dataset.mode ?? 'cubecobra';
  const wmKey    = wmSelect.value;
  const styleKey = styleSelect.value;
  const artOverride = document.getElementById('artUrl').value.trim();

  applyPageSettings();

  printBtn.style.display      = 'none';
  downloadBtn.style.display   = 'none';
  batchEditBtn.style.display  = 'none';
  exportYamlBtn.style.display = 'none';
  setStatus('');

  let decks;

  if (mode === 'manual') {
    const text = document.getElementById('manualText').value.trim();
    if (!text) { setStatus('Enter a deck list in the text area.', 'error'); return; }
    decks = parseManualDeck(text);
    if (!decks.length) { setStatus('No cards found — check the format.', 'error'); return; }
  } else {
    const cubeId = extractCubeId(document.getElementById('cubeId').value.trim());
    if (!cubeId) { setStatus('Enter a Cube ID or slug.', 'error'); return; }

    generateBtn.disabled = true;
    setStatus('Fetching cube data…', 'loading');
    try {
      const data = await fetchCubeData(cubeId);
      decks = parseDecks(data);
      refreshCacheDropdown();
    } catch (err) {
      setStatus(`Error: ${err.message}`, 'error');
      generateBtn.disabled = false;
      return;
    }
    if (!decks.length) {
      setStatus('No tagged decks found in this cube.', 'error');
      generateBtn.disabled = false;
      return;
    }
  }

  generateBtn.disabled = true;
  setStatus(`Rendering ${decks.length} card${decks.length !== 1 ? 's' : ''}…`, 'loading');

  try {
    await renderDecks(decks, wmKey, styleKey, artOverride);
    setStatus(`${decks.length} deck card${decks.length !== 1 ? 's' : ''} generated.`);
    printBtn.style.display      = '';
    downloadBtn.style.display   = '';
    batchEditBtn.style.display  = '';
    exportYamlBtn.style.display = '';
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
  } finally {
    generateBtn.disabled = false;
  }
});

// ── PRINT + DOWNLOAD ──────────────────────────────────────────────────────────

printBtn.addEventListener('click', async () => {
  applyPageSettings();
  printBtn.disabled = true;
  setStatus('Preparing cards for print…', 'loading');
  try {
    // Materialize full-res print canvases on demand; afterprint disposes them.
    await materializePrintCanvases();
    setStatus('');
    window.print();
  } finally {
    printBtn.disabled = false;
  }
});

downloadBtn.addEventListener('click', downloadAll);
batchEditBtn.addEventListener('click', openBatchEdit);

// ── DECK YAML IMPORT / EXPORT (D1) ─────────────────────────────────────────────

exportYamlBtn.addEventListener('click', downloadDecksYaml);

importYamlBtn.addEventListener('click', () => importYamlInput.click());

importYamlInput.addEventListener('change', async () => {
  const file = importYamlInput.files?.[0];
  importYamlInput.value = '';        // allow re-importing the same file
  if (!file) return;

  let decks, settings;
  try {
    ({ decks, settings } = parseDeckYaml(await file.text()));
  } catch (err) {
    setStatus(`Could not read YAML: ${err.message}`, 'error');
    return;
  }
  if (!decks.length) { setStatus('No decks found in that YAML file.', 'error'); return; }

  applyPageSettings();
  setStatus(`Rendering ${decks.length} card${decks.length !== 1 ? 's' : ''}…`, 'loading');
  try {
    // Per-deck settings from the YAML (watermark/style/art/etc.) win; any deck
    // that left a field unset falls back to the current global selection.
    await renderDecks(decks, wmSelect.value, styleSelect.value,
                      document.getElementById('artUrl').value.trim(), settings);
    setStatus(`${decks.length} deck card${decks.length !== 1 ? 's' : ''} imported.`);
    printBtn.style.display      = '';
    downloadBtn.style.display   = '';
    batchEditBtn.style.display  = '';
    exportYamlBtn.style.display = '';
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
  }
});
