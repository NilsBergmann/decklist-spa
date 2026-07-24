// ── TEXT LAYOUT + RENDERING ──────────────────────────────────────────────────
// Style-agnostic: no CC-specific coordinates, font names, or markup.
// Supports tokens: plain text, \n, {bold}/{/bold}, {fontcolor#hex},
// {rightN} tab-stop, inline mana symbols {g}/{1}/…

import { loadImage, manaSrc, MANA_CODES } from './assets.js?v=1';
import { DIVIDER_COLOR, DIVIDER_LINE_WIDTH_FRAC } from '../config.js?v=3';

// Fraction of the block's base font size given to a {divider} line's gap.
const DIVIDER_GAP_FRAC = 0.30;
// Low-alpha neutral fill alternated behind every other data row when a
// writeText call opts into textObj.zebraTint.
const ZEBRA_TINT_COLOR = 'rgba(0,0,0,0.05)';

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
    if (span.type === 'mana' || span.type === 'diamond') {
      const spanX = span.x ?? 0;
      const total = spanX + span.width + (span.gap || 0);
      if (currentW + total > maxWidth && current.length > 0) {
        lines.push(current); current = []; currentW = 0;
      }
      // span.x (set by a preceding {rightN} tag) is an ABSOLUTE tab-stop, not
      // an incremental advance — keep it even when this isn't the first span
      // on the line (e.g. a count prefix already sits before the diamond),
      // otherwise the diamond silently collapses to "right after whatever
      // came before it" instead of its intended aligned column.
      current.push({ ...span });
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

      // null means "no tab, keep flowing from the current cursor" — a real
      // tab-stop (even {rjustN} landing at 0 or negative, when its text
      // overflows past the box's left edge) must stay distinguishable from
      // "no tab", so 0 can't double as that sentinel here.
      const tabX      = wi === 0 && span.x != null ? span.x : null;
      const wordStart = tabX != null ? tabX : currentW;

      if (wordStart + fw > maxWidth && current.length > 0) {
        lines.push(current); current = []; currentW = 0;
      }
      current.push({ ...span, text: fragment, x: wi === 0 ? span.x : null, width: fw });
      currentW = (tabX != null ? tabX : currentW) + fw;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

// Builds spans for one paragraph's tokens at a given font size, carrying
// bold/color state in and out (a {bold}/{fontcolor} tag can appear mid-paragraph).
// baseFontSize is the block's own (pre-shrink) font size — {diamond} sizes
// itself off that instead of the (possibly individually-shrunk) fontSize,
// so a long name's own shrink doesn't shrink its rarity diamond too, and
// diamonds stay the same size across every row in the block.
function buildParagraphSpans(ctx, tokens, { fontFamily, fontSize, baseFontSize, bold, color }) {
  let indentX = null;   // null = no tab, keep flowing; a number = jump to that absolute x (even 0 or negative)
  let sizeScale = 1;
  let rjustX = null;
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
      if (t.startsWith('size')) {
        // {sizeN}: scales subsequent text spans to N% of this row's own
        // font size, until reset by another {sizeN} (persists like bold/
        // color, not a one-shot like {rightN}/{rjustN}) — used to shrink a
        // count prefix so it fits ahead of a tight diamond tab-stop.
        const n = parseFloat(t.slice('size'.length));
        sizeScale = (Number.isFinite(n) ? n : 100) / 100;
        continue;
      }
      if (t.startsWith('rjust')) {
        // {rjustN}: like {rightN} but right-justifies the NEXT text span so
        // its right edge lands at N×baseFontSize/100 — the span's own width
        // (measured at its own, possibly {size}-scaled, font size) decides
        // how far left it starts, so it never overlaps whatever tab-stop
        // sits right after it regardless of digit count.
        const n = parseFloat(t.slice('rjust'.length)) || 0;
        rjustX = Math.round(n * (baseFontSize ?? fontSize) / 100);
        continue;
      }
      if (t.startsWith('right')) {
        // {rightN}: absolute tab-stop at N×baseFontSize/100 px from text-box
        // left. Anchored to baseFontSize (not this row's own, possibly
        // shrunk, fontSize) so every row's tab-stop — and whatever sits at
        // it, like the rarity diamond — lines up in the same column
        // regardless of which rows needed shrinking to fit.
        const n = parseFloat(t.slice('right'.length)) || 0;
        indentX = Math.round(n * (baseFontSize ?? fontSize) / 100);
        continue;
      }
      if (t === 'diamond') {
        const dsz = baseFontSize ?? fontSize;
        ctx.font = `${dsz}px ${fontFamily}`;
        const dw = ctx.measureText('◆').width;
        spans.push({ type: 'diamond', size: dsz, fontFamily, color, x: indentX, width: dw });
        indentX = null;
        continue;
      }
      // Inline mana symbol
      const code = t.replace(/[-\/]/g, '');
      if (MANA_CODES.has(code)) {
        const sz = Math.round(fontSize * 0.78);
        spans.push({ type: 'mana', code, size: sz, width: sz, x: indentX, gap: Math.round(fontSize * 0.05) });
        indentX = null;
      }
      continue;
    }
    if (!tok.value) continue;
    const spanSize = Math.round(fontSize * sizeScale);
    const font = `${bold ? 'bold ' : ''}${spanSize}px ${fontFamily}`;
    ctx.font = font;
    const w = ctx.measureText(tok.value).width;
    let x = indentX;
    if (rjustX != null) { x = rjustX - w; rjustX = null; }
    spans.push({
      type: 'text', text: tok.value, bold, italic: false,
      color, fontFamily, size: spanSize,
      x, width: w,
    });
    indentX = null;
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
    // {divider}: a lone-token paragraph renders as a gap + rule (drawn in
    // writeText) instead of text. Its height rides along in `lines` so the
    // existing lines.reduce(...) height math (fitText, and the manual
    // measure() budgets in m15.js/m15-2col.js) counts it automatically.
    if (paraTokens.length === 1 && paraTokens[0].type === 'tag' && paraTokens[0].value.toLowerCase() === 'divider') {
      lines.push({ isDivider: true, spans: [], lineHeight: fontSize * DIVIDER_GAP_FRAC, baseline: 0 });
      continue;
    }

    // {header}: strip the marker and tag the resulting line(s) isHeader —
    // writeText's zebra-tint uses this to skip section headings and not
    // count them toward the alternation.
    let isHeaderParagraph = false;
    let ownTokens = paraTokens;
    if (paraTokens.length && paraTokens[0].type === 'tag' && paraTokens[0].value.toLowerCase() === 'header') {
      isHeaderParagraph = true;
      ownTokens = paraTokens.slice(1);
    }

    let paraFontSize = fontSize;
    let wrapped;
    if (oneLinePerRow) {
      for (;;) {
        const built = buildParagraphSpans(ctx, ownTokens, { fontFamily, fontSize: paraFontSize, baseFontSize: fontSize, bold, color });
        wrapped = wrapParagraph(ctx, built.spans, maxWidth, paraFontSize);
        if (wrapped.length <= 1 || paraFontSize <= minParaFontSize) {
          bold = built.bold; color = built.color;
          break;
        }
        paraFontSize -= 1;
      }
    } else {
      const built = buildParagraphSpans(ctx, ownTokens, { fontFamily, fontSize: paraFontSize, baseFontSize: fontSize, bold, color });
      wrapped = wrapParagraph(ctx, built.spans, maxWidth, paraFontSize);
      bold = built.bold; color = built.color;
    }
    const lineHeight = paraFontSize * lineHeightMult;
    const baseline   = paraFontSize * 0.88;
    // nominalLineHeight uses the BLOCK's own fontSize (not this paragraph's
    // possibly individually-shrunk paraFontSize) — the zebra tint (writeText)
    // draws at this height instead of lineHeight, so a long name shrinking
    // to fit doesn't also shrink its own stripe shorter than its neighbors'.
    const nominalLineHeight = fontSize * lineHeightMult;
    // isContinuation marks every physical line after a paragraph's first —
    // happens when even the shrink floor isn't enough to fit a very long
    // name on one line. writeText's zebra-tint treats these as still part
    // of the same logical row (same tint state, doesn't advance the
    // alternation), or a wrapped row would count as two rows and throw the
    // stripe pattern off for everything after it.
    wrapped.forEach((spans, i) => lines.push({ spans, lineHeight, nominalLineHeight, baseline, isHeader: isHeaderParagraph, isContinuation: i > 0 }));
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

  // Dividers/zebra-tint are background decoration, not text layout — they
  // default to the text box's own bounds but can be widened independently
  // via decorX/decorWidth (e.g. when the text box's left/right margins
  // aren't symmetric, so a "full width" background would otherwise look
  // lopsided against the text's own tab-stops).
  // Rounded to whole pixels — a fractional x (e.g. 148.74) anti-aliases into
  // a soft ~1px blur against the frame border art, which reads as a faint
  // gap rather than a crisp flush edge once zoomed in.
  const decorX0 = Math.round(textObj.decorX != null ? scaleX(textObj.decorX, card) : x0);
  const decorBw = Math.round(textObj.decorWidth != null ? scaleWidth(textObj.decorWidth, card) : bw);

  const fontFamily = textObj.font;
  const fontSize0  = Math.round(scaleHeight(textObj.size, card));

  const { lines } = await fitText(ctx, textObj.text, {
    fontFamily, fontSize: fontSize0, maxWidth: bw, boxHeight: bh,
    lineHeightMult: textObj.lineHeightMult ?? 1.22,
    minLineHeightMult: textObj.minLineHeightMult,
    oneLinePerRow: textObj.oneLinePerRow ?? true,
  });

  let cy = y0;
  let rowIndex = 0;
  for (const line of lines) {
    if (line.isDivider) {
      const dy = cy + line.lineHeight / 2;
      ctx.save();
      ctx.strokeStyle = DIVIDER_COLOR;
      ctx.lineWidth = Math.max(1, Math.round(scaleHeight(DIVIDER_LINE_WIDTH_FRAC, card)));
      ctx.beginPath();
      ctx.moveTo(decorX0, dy);
      ctx.lineTo(decorX0 + decorBw, dy);
      ctx.stroke();
      ctx.restore();
      cy += line.lineHeight;
      continue;
    }

    if (textObj.zebraTint && !line.isHeader) {
      if (!line.isContinuation) rowIndex++;
      if (rowIndex % 2 === 0) {
        ctx.save();
        ctx.fillStyle = ZEBRA_TINT_COLOR;
        ctx.fillRect(decorX0, cy, decorBw, line.nominalLineHeight ?? line.lineHeight);
        ctx.restore();
      }
    }

    let cx = x0;
    for (const span of line.spans) {
      // null means "no tab, keep flowing" — an explicit tab-stop at 0 or
      // negative (e.g. a right-justified count wide enough to overflow past
      // the box's own left edge) must still be honored, so this can't just
      // check span.x > 0.
      if (span.x != null) cx = x0 + span.x;
      if (span.type === 'mana') {
        const img = await loadImage(manaSrc(span.code));
        const sz  = span.size;
        // Text sits at a baseline fixed relative to font size (line.baseline
        // = paraFontSize × 0.88), independent of line.lineHeight. The icon
        // must anchor the same way — purely off its own size (sz, itself
        // proportional to paraFontSize) — or it drifts relative to the text
        // whenever a block's lineHeightMult isn't the original fixed 1.22
        // this offset was tuned against (line.lineHeight can now be
        // squeezed or stretched well away from that). 0.157×sz reproduces
        // the original look at 1.22 leading, but stays locked to the text
        // regardless of leading.
        const iy = cy + sz * 0.157;
        ctx.drawImage(img, cx, iy, sz, sz);
        cx += sz + span.gap;
      } else if (span.type === 'diamond') {
        // Fixed size (span.size = the block's base font size, not this
        // row's own — possibly shrunk — one) so every row's diamond
        // matches; same baseline as the row's own text so it still sits on
        // the same visual line as the name next to it.
        ctx.save();
        ctx.font      = `${span.size}px ${span.fontFamily}`;
        ctx.fillStyle = span.color || '#000000';
        ctx.fillText('◆', cx, cy + line.baseline);
        cx += span.width;
        ctx.restore();
      } else {
        ctx.save();
        ctx.font      = `${span.bold ? 'bold ' : ''}${span.italic ? 'italic ' : ''}${span.size}px ${span.fontFamily}`;
        ctx.fillStyle = span.color || '#000000';
        if (line.isHeader) {
          // "bold" alone looks the same weight the font ships with (or a
          // browser-synthesized bold, which can be subtle). Stroke the
          // glyph outline before filling to visibly thicken section
          // headings beyond normal bold.
          ctx.strokeStyle = span.color || '#000000';
          ctx.lineWidth   = Math.max(1, Math.round(span.size * 0.018));
          ctx.lineJoin    = 'round';
          ctx.strokeText(span.text, cx, cy + line.baseline);
        }
        ctx.fillText(span.text, cx, cy + line.baseline);
        cx += span.width;
        ctx.restore();
      }
    }
    cy += line.lineHeight;
  }
}
