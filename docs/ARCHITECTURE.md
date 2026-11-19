# Architecture

Mutant Mermaid turns short, Mermaid-shaped text into handsome SVG, in the browser or headless in
Node. Each diagram type owns its parser, layout and drawing. They all share one theme engine, one
text measurer and one SVG pipeline.

```
source text ──► frontmatter ──► keyword ──► DiagramType.parse ──► model
                                                   │
           tokens (theme) + TextKit + seeded Rng ──┴──► DiagramType.render ──► Drawing
                                                                     │
                                         svgDocument (bg, defs, font) ┴──► SVG ──► PNG (node, resvg)
```

## Layout of the repo

| Path | What |
|---|---|
| `src/theme/` | OKLCH theme engine: presets → `Tokens` (neutrals, categorical `Swatch`es, semantic swatches, font) |
| `src/core/render.ts` | Registry, keyword detection, `render()` / `tryRender()` |
| `src/core/types.ts` | `DiagramType<M>`, `Context`, `Drawing`, `define()` |
| `src/core/parse.ts` | `readLines`, `indentTree`, `labeled` (trailing `key=value`, `!flag`, `#color`), `frontmatter` |
| `src/core/text.ts` | DOM-free text measurement and wrapping from generated width tables (`src/core/metrics/`) |
| `src/core/geometry.ts` | Smooth paths, ribbons (tapered branches), arcs, arrowheads, rounded polygons, blobs |
| `src/core/svg.ts` | `h()` element builder, `text()` multi-line labels, `svgDocument()` |
| `src/core/look.ts` | Shared filters (`mm-shadow`, `mm-grain`, `mm-ink`) |
| `src/diagrams/<family>/` | One folder per family; `index.ts` exports `Registered[]` |
| `src/mermaid/` | Our Mermaid theme, plus Mermaid rendering in the browser and headless |
| `src/node.ts` | Node entry: `svgToPng`, `renderPng` (resvg + bundled fonts) |
| `src/cli.ts` | `mutant-mermaid render file.mmd -o out.png` |
| `examples/<family>/*.mmd` | Gallery examples, which double as visual test cases |
| `gallery/` | Vite app that shows every example in every theme |
| `test/` | Vitest |

## Adding a diagram type

1. Write `src/diagrams/<family>/<name>.ts` exporting a `DiagramType<Model>`:
   - `keywords`: the first word that selects it.
   - `parse(source) → { model, diagnostics }`: never throws. It reports problems as diagnostics with
     1-based line numbers and a message that says how to fix the source.
   - `render(model, ctx) → Drawing`: `{ width, height, body, defs?, css?, title? }`. Coordinates
     run from (0, 0) to (width, height); leave a margin of about 24px.
2. Add `define(yourType)` to the family's `index.ts`.
3. Add examples in `examples/<family>/`, then run `pnpm snapshots <family>` and look at the PNGs in
   `out/<family>/`.
4. Add tests in `test/<family>.test.ts`, then run `pnpm test` and `pnpm typecheck`.

## Design principles

- **Shape follows meaning.** Things that are geometric in meaning stay crisp: pyramids, matrices,
  layer stacks, timelines and grids. Things that are organic in meaning get curves: mind map
  links, feedback loops, flows. "Organic" is a tool, not the goal.
- **Looks.** `clean` is the default: precise, no jitter. `sketch` adds seeded hand-made variation and
  paper grain; honour it with `ctx.tokens.look === 'sketch'`. `organic` softens corners and curves
  where the type allows it.
- **Color carries structure.** Use one swatch per top-level group or category, from
  `pick({ tokens, index })`. Within a swatch:
  - large areas take `fill` or `soft`;
  - lines take `stroke`;
  - emphasis and arrowheads take `strong`;
  - text on a fill takes `ink`.

  Neutral text takes `tokens.fg`, `muted` or `faint`. Never hard-code a color. Everything must work
  in dark mode (`--dark`).
- **Semantic swatches** live in `tokens.semantic`:
  - `positive` and `negative`: support/attack, gains/losses;
  - `reinforcing` (warm) and `balancing` (cool): feedback loops;
  - `caution`;
  - `neutral`.
- **Type.**
  - Sizes: base labels 14–15px; titles 20px at weight 800; notes 12–13px in `muted`.
  - Measure with `ctx.text.width()` and wrap with `ctx.text.wrap()` or `balance()`.
  - Place text with `text()` from `core/svg.ts`, which does baseline arithmetic. Don't use
    `dominant-baseline`: resvg and WebKit disagree on it.
- **Determinism.** Use `ctx.rng` for all randomness, never `Math.random`. The same source must render
  the same SVG.
- **Syntax.**
  - Mermaid-shaped and line-oriented, with indentation for nesting and `%%` comments.
  - A header line (`keyword "Title" key=value`), then content.
  - Never require coordinates. The engine infers structure, so the text stays short.
  - Accept common variants rather than failing; say clearly what's wrong when parsing does fail.
- **Readability first.** No overlapping labels, generous spacing, and labels kept horizontal.

## Performance

Hosts render on their own thread, so a slow layout stalls them. Keep every example under about
100 ms, and keep heavy dependencies out of the import path: load them on first use, as
`flow/layout.ts` does with elkjs.

- `pnpm bench [filter] [--runs n]` times `render()` in-process for each example. It shows the cold
  first render, the median and the slowest run, and the time spent in each span.
- `pnpm bench --budget 100` exits 1 when any median passes the budget, and `--json` prints rows
  you can compare between two branches.
- `pnpm bench:profile cld-city --runs 1` writes a CPU profile to `profiles/`. Open it in Chrome
  DevTools or speedscope to see which functions take the time.
- `span(name, fn)` from `core/profile.ts` times a phase by name. It costs one null check unless
  `profiling()` is collecting, so spans can stay in shipped code. Wrap each costly phase of a new
  layout in one, named `<type>:<phase>`.
- An optimization should not change the output. Before you start, render every example to SVG,
  then diff the SVGs when you're done. Changing a layout to make it faster is a separate decision.

## Code conventions (enforced by hooks)

- No type assertions (`as T`); narrow with guards instead. `as const` is fine.
- No two consecutive parameters of the same type; pass an object.
- No nested ternaries, and no nested `if`s: use guard clauses.
- Functions stay under about 30 statements and a cognitive complexity of 15; split long ones.
  Keep conditions simple: name a compound condition rather than inlining it.
- No inline arrow functions as properties of a returned object literal. Name them first, or use
  method shorthand.
- No comments inside function bodies. Explain with doc comments on the function, or with names.
- Imports use `.ts` extensions.
