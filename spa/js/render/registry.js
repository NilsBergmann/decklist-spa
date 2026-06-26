// ── RENDERER REGISTRY ────────────────────────────────────────────────────────
// Renderers self-register by calling register(obj).
// Never imports any concrete renderer — dependency stays acyclic.

const _renderers = {};

export function register(renderer) {
  _renderers[renderer.key] = renderer;
}

export function get(key) {
  return _renderers[key] ?? null;
}

export function list() {
  return Object.values(_renderers);
}
