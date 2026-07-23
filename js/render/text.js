// ── TEXT LAYOUT + RENDERING ──────────────────────────────────────────────────
// Style-agnostic: no CC-specific coordinates, font names, or markup.
// Supports tokens: plain text, \n, {bold}/{/bold}, {fontcolor#hex},
// {rightN} tab-stop, inline mana symbols {g}/{1}/…

import { loadImage, manaSrc, MANA_CODES } from './assets.js?v=1';

// ── FRACTIONAL-TO-PIXEL SCALE HELPERS ────────────────────────────────────────
// Identical interface to CC's creator-23.js helpers.

export function scaleX(f, card)      { return (f + (card.marginX || 0)) * card.width;  }
export function scaleY(f, card)      { return (f + (card.marginY || 0)) * card.height; }
export function scaleWidth(f, card)  { return f * card.width;  }
export function scaleHeight(f, card) { return f * card.height; }

// ── TOKENISER ────────────────────────────────────────────────────────────────

export function tokenise(raw) {
  const tokens = [];
  const re = /\{([^}]*)\}|\\n|\n|([^{}\n\\]+)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    if (m[1] !== undefined) {
      tokens.push({ type: 'tag', value: m[1] });
    } else if (m[0] === '\\n' || m[0] === '\n') {
      tokens.push({ type: 'newline' });
    } else {
      tokens.push({ type: 'text', value: m[2] });
    }
  }
  return tokens;
}

// ── PARAGRAPH WORD-WRAP ───────────────────────────────────────────────────────

export function wrapParagraph(ctx, spans, maxWidth, fontSize) {
  if (spans.length === 0) return [[]];   // blank line

  const lines = [];
  let current = [], currentW = 0;

  for (const span of spans) {
    if (span.type === 'mana') {
      const total = span.x + span.size + span.gap;
      if (currentW + total > maxWidth && current.length > 0) {
        lines.push(current); current = []; currentW = 0;
      }
      current.push({ ...span, x: current.length === 0 ? span.x : 0 });
      currentW += total;
      continue;
    }

    const words = span.text.split(' ');
    for (let wi = 0; wi < words.length; wi++) {
      const word     = words[wi];
      const sep      = wi < words.length - 1 ? ' ' : '';
      const fragment = word + sep;
      const font = `${span.bold ? 'bold ' : ''}${span.size}px ${span.fontFamily}`;
      ctx.font = font;
      const fw = ctx.measureText(fragment).width;

      const tabStop  = wi === 0 && span.x > 0 ? span.x : 0;
      const wordStart = tabStop > 0 ? tabStop : currentW;

      if (wordStart + fw > maxWidth && current.length > 0) {
        lines.push(current); current = []; currentW = 0;
      }
      current.push({ ...span, text: fragment, x: wi === 0 ? span.x : 0, width: fw });
      currentW = (tabStop > 0 ? tabStop : currentW) + fw;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

// Builds spans for one paragraph's tokens at a given font size, carrying
// bold/color state in and out (a {bold}/{fontcolor} tag can appear mid-paragraph).
function buildParagraphSpans(ctx, tokens, { fontFamily, fontSize, bold, color }) {
  let indentX = 0;
  const spans = [];

  for (const tok of tokens) {
    if (tok.type === 'tag') {
      const t = tok.value.toLowerCase();
      if (t === 'bold')              { bold = true; continue; }
      if (t === '/bold')             { bold = false; continue; }
      if (t.startsWith('fontcolor')) {
        color = tok.value.slice('fontcolor'.length) || '#000000';
        continue;
      }
      if (t.startsWith('right')) {
        // {rightN}: absolute tab-stop at N×fontSize/100 px from text-box left
        const n = parseFloat(t.slice('right'.length)) || 0;
        indentX = Math.round(n * fontSize / 100);
        continue;
      }
      // Inline mana symbol
      const code = t.replace(/[-\/]/g, '');
      if (MANA_CODES.has(code)) {
        const sz = Math.round(fontSize * 0.78);
        spans.push({ type: 'mana', code, size: sz, x: indentX, gap: Math.round(fontSize * 0.05) });
        indentX = 0;
      }
      continue;
    }
    if (!tok.value) continue;
    const font = `${bold ? 'bold ' : ''}${fontSize}px ${fontFamily}`;
    ctx.font = font;
    const w = ctx.measureText(tok.value).width;
    spans.push({
      type: 'text', text: tok.value, bold, italic: false,
      color, fontFamily, size: fontSize,
      x: indentX, width: w,
    });
    indentX = 0;
  }

  return { spans, bold, color };
}

// ── LAYOUT TEXT ──────────────────────────────────────────────────────────────
// Each paragraph (line of markup, split on \n) is laid out independently. By
// default (oneLinePerRow: true — used by the full-width single-column m15
// style, where a paragraph wrapping is rare and worth avoiding) a paragraph
// that would wrap onto a second line at the block's font size instead has
// its own font size shrunk (down to minParaFontSize) until it fits on one
// line, without affecting the other paragraphs' size. With oneLinePerRow:
// false (the narrower 2-column style, where a plain wrap looks normal and
// avoids many differently-shrunk row sizes side by side) paragraphs just
// wrap at the given font size instead of shrinking.

export async function layoutText(ctx, rawText, {
  fontFamily, fontSize, maxWidth, lineHeightMult = 1.22, oneLinePerRow = true,
}) {
  const tokens = tokenise(rawText);

  const tokenParagraphs = [[]];
  for (const tok of tokens) {
    if (tok.type === 'newline') { tokenParagraphs.push([]); continue; }
    tokenParagraphs[tokenParagraphs.length - 1].push(tok);
  }

  const minParaFontSize = Math.round(fontSize * 0.6);
  let bold = false, color = '#000000';
  const lines = [];

  for (const paraTokens of tokenParagraphs) {
    let paraFontSize = fontSize;
    let wrapped;
    if (oneLinePerRow) {
      for (;;) {
        const built = buildParagraphSpans(ctx, paraTokens, { fontFamily, fontSize: paraFontSize, bold, color });
        wrapped = wrapParagraph(ctx, built.spans, maxWidth, paraFontSize);
        if (wrapped.length <= 1 || paraFontSize <= minParaFontSize) {
          bold = built.bold; color = built.color;
          break;
        }
        paraFontSize -= 1;
      }
    } else {
      const built = buildParagraphSpans(ctx, paraTokens, { fontFamily, fontSize: paraFontSize, bold, color });
      wrapped = wrapParagraph(ctx, built.spans, maxWidth, paraFontSize);
      bold = built.bold; color = built.color;
    }
    const lineHeight = paraFontSize * lineHeightMult;
    const baseline   = paraFontSize * 0.88;
    for (const spans of wrapped) lines.push({ spans, lineHeight, baseline });
  }

  return lines;
}

// ── FIT TEXT ─────────────────────────────────────────────────────────────────
// Measure-only shrink-to-fit: finds the largest font size (and, within that,
// the largest line-height multiplier) that lays `rawText` out within
// maxWidth × boxHeight, without drawing anything. writeText uses this to
// render; callers that need several text blocks to share one consistent
// font size (rather than each shrinking independently to a different size)
// can call this per block first, take the smallest result, and pass that
// back in as `fontSize` to every writeText call.
//
// Overflow is resolved in two stages: first the line-height is squeezed from
// lineHeightMult down to minLineHeightMult (free — same font, just tighter
// leading), and only once that floor is reached does font size shrink.
// Callers that don't pass either multiplier get the original fixed-1.22-
// leading, shrink-font-only behavior.

export async function fitText(ctx, rawText, {
  fontFamily, fontSize, maxWidth, boxHeight, lineHeightMult = 1.22, minLineHeightMult, oneLinePerRow = true,
}) {
  const minLHM = minLineHeightMult ?? lineHeightMult;
  const minSize = Math.round(fontSize * 0.5);

  let size = fontSize;
  let lines, lhMultUsed;
  while (size >= minSize) {
    let lhMult = lineHeightMult;
    for (;;) {
      lines = await layoutText(ctx, rawText, { fontFamily, fontSize: size, maxWidth, lineHeightMult: lhMult, oneLinePerRow });
      const totalH = lines.reduce((s, l) => s + l.lineHeight, 0);
      if (totalH <= boxHeight || lhMult <= minLHM) { lhMultUsed = lhMult; break; }
      lhMult = Math.max(minLHM, lhMult - 0.02);
    }
    const totalH = lines.reduce((s, l) => s + l.lineHeight, 0);
    if (totalH <= boxHeight || size <= minSize) break;
    size -= 1;
  }

  return { fontSize: size, lineHeightMult: lhMultUsed, lines };
}

// ── WRITE TEXT ────────────────────────────────────────────────────────────────
// textObj: { text, font, x, y, width, height, size, oneLine?, lineHeightMult?,
//            minLineHeightMult?, oneLinePerRow? }
// card: { width, height, marginX, marginY }

export async function writeText(ctx, card, textObj) {
  const x0 = scaleX(textObj.x, card);
  const y0 = scaleY(textObj.y, card);
  const bw = scaleWidth(textObj.width, card);
  const bh = scaleHeight(textObj.height, card);

  const fontFamily = textObj.font;
  const fontSize0  = Math.round(scaleHeight(textObj.size, card));

  const { lines } = await fitText(ctx, textObj.text, {
    fontFamily, fontSize: fontSize0, maxWidth: bw, boxHeight: bh,
    lineHeightMult: textObj.lineHeightMult ?? 1.22,
    minLineHeightMult: textObj.minLineHeightMult,
    oneLinePerRow: textObj.oneLinePerRow ?? true,
  });

  let cy = y0;
  for (const line of lines) {
    let cx = x0;
    for (const span of line.spans) {
      if (span.x > 0) cx = x0 + span.x;
      if (span.type === 'mana') {
        const img = await loadImage(manaSrc(span.code));
        const sz  = span.size;
        const iy  = cy + line.lineHeight * 0.5 - sz * 0.5 - line.lineHeight * 0.08;
        ctx.drawImage(img, cx, iy, sz, sz);
        cx += sz + span.gap;
      } else {
        ctx.save();
        ctx.font      = `${span.bold ? 'bold ' : ''}${span.italic ? 'italic ' : ''}${span.size}px ${span.fontFamily}`;
        ctx.fillStyle = span.color || '#000000';
        ctx.fillText(span.text, cx, cy + line.baseline);
        cx += span.width;
        ctx.restore();
      }
    }
    cy += line.lineHeight;
  }
}
