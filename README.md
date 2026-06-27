# Decklist Generator

A browser app that turns a Magic: The Gathering cube or deck list into
print-ready "deck cards" — single cards that summarise a whole deck's contents,
handy as dividers or pack fronts. It runs entirely client-side; there is no
build step and no backend.

Live: https://nilsbergmann.github.io/decklist-spa/

## What it does

- **Two input modes**
  - **Cubecobra** — paste a cube ID, slug, or URL; decks are built from the
    cube's card tags. Results are cached locally for 24h.
  - **Manual** — type a deck list directly (`# Title`, type headers, and
    `count Name {cost} (rarity)` lines).
- **Three render styles**
  - `m15` — a Card Conjurer M15 frame with the deck contents as rules text.
  - `art-bg` — full-bleed background art behind a frosted-glass text panel.
  - `cover` — a Jumpstart-style pack front (full art, title, subtitle, set
    symbol, color pips).
- **Per-card editing** — click a card to edit its deck list, subtitle (cover),
  and art, with a live preview that updates as you type. Art can be picked
  visually from the deck's cards or searched on Scryfall, or set by URL
  (a `scryfall.com/card/…` page URL auto-resolves to its art crop).
- **Watermarks** — set symbols (auto by deck colors, or pick a specific set).
- **Output** — print to PDF (A4 / US Letter, 3×3 per page, optional crop marks)
  or download each card as a PNG.
- **YAML import/export** — save and reload a set of decks.

## Running locally

Served via Docker (static file server over the `spa/` folder):

```sh
docker compose -f spa/compose.yaml up -d
```

Then open http://localhost:8787. The folder is volume-mounted, so edits are
live on reload — no rebuild.

## Deployment

Pushing to `main` (or `master`) triggers the GitHub Actions workflow in
`.github/workflows/deploy-pages.yml`, which publishes `spa/` to GitHub Pages.

## Layout

```
spa/
  index.html        # app shell + modals
  style.css
  js/
    main.js         # entry point: wires the control panel
    cube-source.js  # Cubecobra fetch/cache, manual + YAML parsing, Scryfall art
    deck-model.js   # style-agnostic deck model consumed by all renderers
    cards-ui.js     # card cells, overlays, edit modal, live preview, download
    state.js        # active card state
    watermarks.js   # watermark/set definitions + resolution
    config.js       # shared constants
    render/
      registry.js   # self-registering renderer registry
      m15.js  art-bg.js  cover.js   # the three render styles
      pips.js  text.js  assets.js  canvas-util.js
```
