# Plan: Pixel-faithful Card Conjurer rendering in the SPA

Goal: Replace the CSS-approximation card rendering in `spa/` with a canvas renderer
that reuses Card Conjurer's real assets, so each deck card matches `cli/doc/example.png`.

All work is scoped to `spa/` only.

## Research findings (reference)

The example image is a Card Conjurer render using the M15 `fullText` frame:
- 2 frame layers: `secondary.png` masked by `maskRightHalf.png` over a full `primary.png`
  (this produces the two-color split).
- Title in **Beleren Bold**, body in **MPlantin** serif.
- Two-tone watermark behind the text at opacity 0.2 (left=primaryHex, right=secondaryHex).
- Inline mana-symbol images, bold type headers, rarity-colored `◆` diamonds.
- Canvas is 2010×2814 with fractional (0–1) coordinates.

Assets confirmed present in `C:\Repositories\cardconjurer`:
- Mana SVGs: `w,u,b,r,g,c,s,x,y,z,0–20` (`img/manaSymbols/*.svg`)
- `fullText` frames: `w,u,b,r,g,m,l,a` + `maskRightHalf.png`
- Fonts: `beleren-b.ttf`, `mplantin.ttf`, `mplantin-i.ttf`, `gotham-medium.ttf`

Note: the example's `fullTextAlt` / `manaSymbolsPixel` paths are upstream-only;
this fork's `fullText` frames + default mana SVGs are the correct stand-ins.

Template coordinates (`cli/output/cardconjurer/template.json.j2`):
- title: belerenb, size 0.0381, x 0.0854, y 0.0522, oneLine
- rules: mplantin, size 0.0362, x 0.086, y 0.1157, w 0.828, h 0.8024
- watermark bounds: x 0.5, y 0.5505, w 0.75, h 0.4562; opacity 0.2
- frames: `/img/frames/m15/fullText/{color}.png`, secondary masked by maskRightHalf

Color → frame-letter map: `W→w, U→u, B→b, R→r, G→g, M→m, C→l`.

Text token format produced by `printDeck` (Python, to mirror):
- title: `{bold}<name>{/bold}`
- type header: `{bold}<Type> (<n>){/bold}`
- card row: `{right10}<count|"    ">{fontcolor#<rarityHex>} ◆ {fontcolor#000000}<name> <cost>`
- rows sorted by type order then rarity; mana like `{g}`, `{1}`.

## Implementation steps

1. Copy asset subset into `spa/assets/`
   - frames/m15/fullText/{w,u,b,r,g,m,l,a}.png + maskRightHalf.png
   - mana/{w,u,b,r,g,c,s,x,y,z,0..20}.svg
   - fonts/{beleren-b.ttf, mplantin.ttf, mplantin-i.ttf, gotham-medium.ttf}

2. `spa/style.css`: add @font-face for the 4 fonts; size canvas (backing 2010×2814,
   display 63mm×88mm); keep the 9-per-page print grid.

3. `spa/render.js` (new) — minimal CC pipeline:
   - scaleX/Y/Width/Height helpers at 2010×2814
   - asset cache + preload (images + document.fonts.ready)
   - drawFrames: primary full; secondary masked by maskRightHalf via source-in
   - drawWatermark: two-tone tint via mask, opacity 0.2, positioned per bounds
   - writeText subset parser: text, newlines, {bold}/{/bold}, {fontcolor#hex},
     {right10} indent, {fontsize}, inline mana {x}→SVG (0.78 scale + baseline offset);
     title=Beleren Bold, rules=MPlantin; auto-fit font size to box height
   - renderCard(ctx, cardData): compose frame → watermark → text; cut rounded corners

4. `spa/app.js`: add buildCardData(deck) mirroring printDeck; color→frame map;
   in generate() create a <canvas> per deck and call renderCard. Keep cache dropdown,
   watermark select, Print button. Remove DOM renderDeck once canvas path verified.

5. `spa/index.html`: add <script src="render.js?v=1"> before app.js; bump app.js cache param.

6. Verify: docker compose up, preview, generate BLB cube, screenshot a mono-green deck
   and a UW deck; compare against example.png; tune mana baseline + bold weight.

## Notes / tradeoffs
- Bundle grows ~2–4 MB (frame PNGs dominate); acceptable (self-contained assets chosen).
- Mana-symbol baseline alignment and synthetic-bold MPlantin are the fiddliest bits.

---

# Phase 2 Plan: improvements from jumpstart-decklists comparison

Scope: all edits in `spa/` only. Compared against `C:\Repositories\jumpstart-decklists`
(Go + manual YAML + headless-Chrome screenshot, text-over-art aesthetic). Our SPA is more
advanced; we cherry-pick ideas. Approved scope = core 3 + all 3 extensions.

## A. Core fixes

### A1. Fix "Z Token" tag leaking into output  (app.js)
- Bug: `IGNORED_TAGS = ['Token', 'Y Token', 'Z Theme']` omits `'Z Token'`, so the
  128-card "Z Token" pseudo-deck renders.
- Fix: add `'Z Token'`, and also ignore any tag matching `/^[YZ]\s/` (Y/Z sort-prefix
  tags) as a forward-proof guard.

### A2. Harden print to real card dimensions  (style.css, index.html)
- jumpstart targets 63×88 mm at 1200 DPI; we already use 63×88 mm (canvas 2010×2814 ≈
  810 DPI — keep). Make print exact + crisp:
  - Add `@page { size: A4 portrait; margin: 0; }`.
  - Grid: page padding 5mm, gap 4mm (fits 3×3 on A4: 197×272 mm ≤ 200×287 printable).
  - `.card { width:63mm; height:88mm; print-color-adjust:exact; -webkit-print-color-adjust:exact; image-rendering:auto; }`
  - Add a page-size selector (A4 / US Letter) in controls; drive `@page size` via a
    body class. Default A4.

### A3. Cut indicators / crop marks  (app.js, style.css)
- Wrap each `<canvas>` in a `.card-cell`; print grid targets `.card-cell`.
- Print-only corner crop ticks drawn in the 4mm gutter using `.card-cell::before/::after`
  + `background` linear-gradient hairlines (0.15mm, #000) at the 4 rectangle corners —
  industry-standard ticks that don't draw across the card face.
- Add a "Crop marks" checkbox in controls (default on); toggles a body class.

## B. Extensions (all approved)

### B1. Color-identity pips  (app.js + render.js)
- buildCardData: compute `colorIdentity` = colors present across non-token cards, sorted
  WUBRG (then C if none).
- render.js `drawColorPips(ctx, card)`: draw mana SVGs (existing w/u/b/r/g/c.svg) in a
  right-aligned row inside the title bar (authentic MTG mana-cost position, ~y=0.052,
  right edge ~0.92), sized ~0.030. Runs after frames, before/with title. Avoids the
  rules text area (starts y=0.116).

### B2. Manual deck-entry mode  (index.html, app.js)
- Add input-mode tabs: "Cubecobra" (current) | "Manual".
- Manual format (offline, no API):
  ```
  # Deck Name
  Creature
  4 Llanowar Elves {g}
  1 Giant Growth {1}{g} (rare)
  Land
  6 Forest
  ```
  - `# ...` = deck name; bare line = type header; `count name {cost...} (rarity?)` = card.
  - `parseManualDeck(text)` → same deck shape as `parseDecks` (type from header, colors
    inferred from cost symbols, rarity default common). Feeds existing buildCardData.
- Stretch (optional, flagged off): Scryfall name lookup to auto-fill type/rarity/colors.

### B3. Background-art render mode  (index.html, app.js, render.js)  ✅ DONE
Implemented as a second registry renderer (`js/render/art-bg.js`) selected via a
new "Style" dropdown. Shared pip drawing extracted to `js/render/pips.js`;
`roundRectPath` added to `canvas-util.js`. Art URL captured from Cubecobra
`details` (`deckArtUrl` = highest-rarity card) with optional user-supplied
override field and a color-identity gradient fallback. Frosted panel uses a
blurred art snapshot + translucent white. CORS-safe (crossOrigin anonymous +
graceful fallback; canvas stays exportable for PNG download).

- Add "Style" selector: "Card Conjurer frame" (current) | "Art background".
- Art mode renderCard path: full-bleed background art → translucent frosted white panel
  (rounded) → title → color pips → rules text → rounded corners. No CC frame/watermark.
- Background source: auto-pick the art of the deck's highest-rarity card via its image
  URL from Cubecobra `details` (fallback: soft color gradient from deck colors); or a
  user-supplied image URL field. CORS-safe loading with graceful fallback.
- New helpers: `drawArtBackground`, `drawGlassPanel`; gate by `cardData.style`.

## Refinements (post-B3/D-series)
- Art-bg style: added a deck-color gradient **outline** hugging the rounded edge, the
  same gradient on the **content panel border**, and a deck-color **separator** between
  title and contents (`drawSeparator` / `drawColorOutline` / `drawGlassPanel` +
  `colorGradient` helper in `js/render/art-bg.js`).
- **Auto-rerender**: changing Style, Watermark, or Art URL re-renders all generated
  cards automatically (serialized via a render queue in `main.js`; `rerenderAll` in
  `cards-ui.js`). Page size / crop marks apply live (print CSS only, no re-render).
- m15 style: increased text left margin (title x 0.0854→0.105, rules x 0.074→0.100;
  widths trimmed to hold the right edge).
- **Ratio-based color split** (m15): two-color decks now split the frame and watermark
  by pip count (`splitRatio` in `deck-model.js`, primary on the left, clamped to
  [0.5, 0.85]) instead of a fixed 50/50. Frame uses a procedural gradient mask
  (replaces the static `maskRightHalf.png`, now unused); watermark gradient stops
  align to the same split. Verified: 10:2→0.85, 8:4→0.68, 6:6→0.51.

## Cover-card style (Jumpstart 2022 front)
Added a third renderer `js/render/cover.js` (`cover` / "Cover card (Jumpstart)").
Reproduces Card Conjurer's `j22Front` template: full-bleed art in the frame window,
`j22Frame.png` overlay (vendored to `spa/assets/frames/jmpfront/`), centered title
(`gothammedium`) + small-caps subtitle (`belerenbsc`, font vendored). Subtitle comes
from a `Title | Subtitle` split in the deck name (`deck-model.js`). Bottom-left: the
selected set-icon watermark, gold-tinted. Bottom-right: mono primary pip + two-color
split (hybrid mana SVG via `GUILD_HYBRID`). Art-URL field now shows for `cover` too.

### ✅ DONE: mono+dual pip style adopted across all renderers
`js/render/pips.js` now uses mono primary + guild hybrid for two-color decks (same
vocabulary as `cover.js`). `GUILD_HYBRID` moved to `js/config.js` (shared). Three+
color decks still fall back to the full WUBRG row.

## C. Verification & housekeeping
- Bump cache-bust: `render.js?v=4`, `app.js?v=8` (and per change after).
- `docker compose -f spa/compose.yaml up -d`; preview each feature:
  - Z Token gone (FDN + TLA cubes).
  - Print preview: measure a card = 63×88 mm; crop ticks visible in gutters; 9/page.
  - Pips render top-right per deck color identity.
  - Manual paste renders a card; Art-background mode renders a card.
- Keep `cli/` untouched (standing instruction).

## Effort / risk
- A1 trivial; A2/A3 small (CSS + thin wrappers); B1 small (canvas draw); B2 medium (parser
  + UI); B3 largest (new render path + art sourcing). Suggested order: A1 → A2 → A3 → B1 →
  B2 → B3, verifying after each.

---

# Phase 3 Plan: backlog

Scope: all edits in `spa/` only.

## D1. Upload / download deck YAMLs  ✅ DONE
Implemented: `decksToYaml` / `parseDeckYaml` in `js/cube-source.js` (self-contained
YAML subset, no library — cards stored compactly with `count`, duplicates expand on
import; values quoted so `{cost}` braces don't trip flow-mapping). Shared
`colorsFromCost` helper. `downloadDecksYaml` in `cards-ui.js`; Import/Export YAML
buttons + hidden file input in `index.html`, wired in `main.js`. Round-trip verified
byte-stable; import renders via the active style/watermark.

- Let users export the current parsed deck(s) to a `.yaml` file and re-import them later.
- Download: serialize the deck model to YAML, trigger a Blob download (mirror the existing
  Download-PNGs button pattern in `index.html` / `cards-ui.js`).
- Upload: file input that reads a `.yaml`, parses to the same deck shape as
  `parseDecks` / `parseManualDeck`, then feeds `buildCardData`.
- Needs a small YAML (de)serializer; keep it dependency-light or vendor a tiny one.

## D2. Host the static page on GitHub Pages  ✅ DONE (needs one-time repo setting)
Added `.github/workflows/deploy-pages.yml` — GitHub Actions deploy of `spa/` on push
to master (path-filtered to `spa/**`, plus manual `workflow_dispatch`). All app paths
are relative, so it works under the `/<repo>/` Pages subpath unchanged.
**One-time manual step:** repo Settings → Pages → Source = "GitHub Actions".

- The SPA is static (no build step) — publish `spa/` via GitHub Pages.
- Decide source: `gh-pages` branch vs `/docs` folder vs Pages-from-Actions.
- Fix any absolute paths / asset references so they work under a project subpath
  (`/<repo>/...`). Verify cache-bust query params and module imports resolve.
- Note CORS implications for Cubecobra fetches + art sourcing from a static host.

## D3. Add missing set icons as watermarks  ✅ DONE
Extended the `WATERMARKS` map in `js/watermarks.js` with 24 Standard-era sets back to
2011 (Innistrad / Return to Ravnica era): XLN→ISD plus core sets M12–M15. Catalog now
59 entries. Icons load live from Scryfall (`SF()`); all added codes verified HTTP 200.

- `js/watermarks.js` currently lists a curated subset of sets (Scryfall-sourced icons).
- Audit which sets are missing and extend the `WATERMARKS` map.
- Confirm the set-icon source (Scryfall `SF()` helper) covers the new sets; vendor SVGs
  into `spa/assets/watermarks/` for any that aren't reliably fetchable / CORS-safe.
