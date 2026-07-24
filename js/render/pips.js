// ── COLOR-IDENTITY PIPS ───────────────────────────────────────────────────────
// Shared by m15 and art-bg renderers: draws the deck's color identity as a
// right-aligned row of mana SVGs in the title band.
// 1-color: mono pip. 2-color: hybrid alone near 50/50, else mono primary +
// hybrid (or two mono pips for a colorless blend, which has no hybrid glyph).
// 3+: full WUBRG row.

import { loadImage, manaSrc, MANA_CODES } from './assets.js?v=1';
import { GUILD_HYBRID }                    from '../config.js?v=3';

export async function drawColorPips(ctx, card, model) {
  const id = model.colorIdentity;
  if (!id || id.length === 0) return;

  let codes;
  if (id.length === 1) {
    codes = [id[0].toLowerCase()];
  } else if (id.length === 2) {
    const guild = GUILD_HYBRID[id.join('')];
    if (guild) {
      // A near-even blend (e.g. WB at 50/50) shows the hybrid symbol alone;
      // a lopsided one (e.g. W at 75/25) shows the dominant mono pip plus
      // the hybrid as a splash hint, same as a real hybrid-heavy card would.
      const balanced = Math.abs((model.splitRatio ?? 0.5) - 0.5) < 0.05;
      codes = balanced ? [guild] : [model.primaryColor.toLowerCase(), guild];
    } else {
      // Colorless blends (e.g. C+W) have no hybrid glyph — always show both
      // mono pips side by side.
      codes = [model.primaryColor.toLowerCase(), model.secondaryColor.toLowerCase()];
    }
  } else {
    codes = id.map(c => c.toLowerCase());
  }

  const h    = card.height, w = card.width;
  const pipH = Math.round(h * 0.028 * 1.5);   // +50% per request
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
