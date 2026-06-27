// ── ENTRY POINT ──────────────────────────────────────────────────────────────
// Wires the control panel; delegates rendering to cards-ui.js.
// Side-effect import of m15.js registers the renderer before any render call.

import './render/m15.js';          // registers m15 renderer
import './render/art-bg.js';       // registers art-background renderer
import './render/cover.js';        // registers cover-card renderer

import { list as listRenderers }  from './render/registry.js';
import { WATERMARKS }              from './watermarks.js';
import {
  extractCubeId, fetchCubeData, parseDecks,
  listCachedIds, parseManualDeck, parseDeckYaml,
} from './cube-source.js?v=33';
import { renderDecks, downloadAll, downloadDecksYaml, rerenderAll, materializePrintCanvases } from './cards-ui.js?v=38';

// ── DOM REFERENCES ────────────────────────────────────────────────────────────

const generateBtn    = document.getElementById('generateBtn');
const printBtn       = document.getElementById('printBtn');
const downloadBtn    = document.getElementById('downloadBtn');
const exportYamlBtn  = document.getElementById('exportYamlBtn');
const importYamlBtn  = document.getElementById('importYamlBtn');
const importYamlInput = document.getElementById('importYamlInput');
const statusEl       = document.getElementById('status');
const cacheSelect    = document.getElementById('cacheSelect');
const cacheLoadBtn   = document.getElementById('cacheLoadBtn');
const cacheDeleteBtn = document.getElementById('cacheDeleteBtn');

// ── STATUS HELPER ─────────────────────────────────────────────────────────────

function setStatus(msg, type = '') {
  statusEl.textContent = msg;
  statusEl.className   = type;
}

// ── WATERMARK DROPDOWN ────────────────────────────────────────────────────────

const wmSelect = document.getElementById('watermark');
wmSelect.innerHTML = Object.entries(WATERMARKS)
  .map(([k, v]) => `<option value="${k}"${k === 'fdn' ? ' selected' : ''}>${v.label}</option>`)
  .join('');

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

const ART_STYLES = new Set(['art-bg', 'cover']);
styleSelect.addEventListener('change', () => {
  artUrlGroup.style.display = ART_STYLES.has(styleSelect.value) ? '' : 'none';
  queueRerender({ styleKey: styleSelect.value });
});
wmSelect.addEventListener('change', () => queueRerender({ wmKey: wmSelect.value }));
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
document.getElementById('pageSize').addEventListener('change', applyPageSettings);
document.getElementById('cropMarks').addEventListener('change', applyPageSettings);

// ── GENERATE ──────────────────────────────────────────────────────────────────

generateBtn.addEventListener('click', async () => {
  const mode     = document.querySelector('.tab.active')?.dataset.mode ?? 'cubecobra';
  const wmKey    = wmSelect.value;
  const styleKey = styleSelect.value;
  const artOverride = document.getElementById('artUrl').value.trim();

  applyPageSettings();

  printBtn.style.display      = 'none';
  downloadBtn.style.display   = 'none';
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

// ── DECK YAML IMPORT / EXPORT (D1) ─────────────────────────────────────────────

exportYamlBtn.addEventListener('click', downloadDecksYaml);

importYamlBtn.addEventListener('click', () => importYamlInput.click());

importYamlInput.addEventListener('change', async () => {
  const file = importYamlInput.files?.[0];
  importYamlInput.value = '';        // allow re-importing the same file
  if (!file) return;

  let decks;
  try {
    decks = parseDeckYaml(await file.text());
  } catch (err) {
    setStatus(`Could not read YAML: ${err.message}`, 'error');
    return;
  }
  if (!decks.length) { setStatus('No decks found in that YAML file.', 'error'); return; }

  applyPageSettings();
  setStatus(`Rendering ${decks.length} card${decks.length !== 1 ? 's' : ''}…`, 'loading');
  try {
    await renderDecks(decks, wmSelect.value, styleSelect.value,
                      document.getElementById('artUrl').value.trim());
    setStatus(`${decks.length} deck card${decks.length !== 1 ? 's' : ''} imported.`);
    printBtn.style.display      = '';
    downloadBtn.style.display   = '';
    exportYamlBtn.style.display = '';
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
  }
});
