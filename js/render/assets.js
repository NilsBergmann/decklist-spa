// ── ASSET LOADING HELPERS ────────────────────────────────────────────────────

export const MANA_CODES = new Set([
  // Mono
  'w','u','b','r','g','c','s','x','y','z',
  // Generic
  '0','1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20',
  // Two-color hybrid
  'wu','wb','ub','ur','br','bg','rg','rw','gw','gu',
  // 2/color hybrid
  '2w','2u','2b','2r','2g',
  // Phyrexian
  'wp','up','bp','rp','gp',
]);

const _imgCache = {};

export function loadImage(src) {
  if (_imgCache[src]) return _imgCache[src];
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    if (src.startsWith('http')) img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => {
      // Don't cache failures — a transient error must not poison the cache and
      // block every later load of this src until a full page reload.
      delete _imgCache[src];
      reject(new Error(`Failed to load: ${src}`));
    };
    img.src = src;
  });
  _imgCache[src] = p;
  return p;
}

export function manaSrc(code) {
  return `assets/mana/${code.toLowerCase()}.svg`;
}

export async function ensureFonts() {
  await document.fonts.ready;
}
