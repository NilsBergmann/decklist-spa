// ── SHARED STATUS LINE ───────────────────────────────────────────────────────
// Single #status element owned here so both main.js (generate/print/download)
// and cards-ui.js (per-card render errors) report through the same non-blocking
// UI instead of main.js owning it privately and other modules falling back to
// alert().

const statusEl = document.getElementById('status');

export function setStatus(msg, type = '') {
  statusEl.textContent = msg;
  statusEl.className   = type;
}
