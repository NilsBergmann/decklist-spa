// ── COLOR-IDENTITY PIPS ───────────────────────────────────────────────────────
// Shared by m15 and art-bg renderers: draws the deck's color identity as a
// right-aligned row of mana SVGs in the title band.
// 1-color: mono pip. 2-color: mono primary + guild hybrid. 3+: full WUBRG row.

import { loadImage, manaSrc, MANA_CODES } from './assets.js';
import { GUILD_HYBRID }                    from '../config.js';

export async function drawColorPips(ctx, card, model) {
  const id = model.colorIdentity;
  if (!id || id.length === 0) return;

  let codes;
  if (id.length === 1) {
    codes = [id[0].toLowerCase()];
  } else if (id.length === 2) {
    const guild = GUILD_HYBRID[id.join('')];
    codes = [model.primaryColor.toLowerCase(), guild].filter(Boolean);
  } else {
    codes = id.map(c => c.toLowerCase());
  }

  const h    = card.height, w = card.width;
  const pipH = Math.round(h * 0.028);
  const gap  = Math.round(w * 0.006);
  const totalW = codes.length * pipH + Math.max(0, codes.length - 1) * gap;

  const rightEdge = Math.round(w * 0.912);
  let px = rightEdge - totalW;
  const yCenter = Math.round(h * 0.076);
  const py = Math.round(yCenter - pipH / 2);

  for (const code of codes) {
    if (MANA_CODES.has(code)) {
      try {
        const img = await loadImage(manaSrc(code));
        ctx.drawImage(img, px, py, pipH, pipH);
      } catch { /* skip missing pip */ }
    }
    px += pipH + gap;
  }
}
