# Mutant Mermaid

Handsome diagrams from short, Mermaid-shaped text. It renders in the browser or headless in Node,
to SVG or PNG. Everything shares one OKLCH theme, so a pyramid, a causal loop diagram and a themed
Mermaid sequence diagram all look like they belong together.

```sh
pnpm install
pnpm gallery                                   # http://localhost:5199: every example, live playground
pnpm exec tsx src/cli.ts render notes.mmd -o notes.png --theme meadow [--dark] [--look sketch]
pnpm exec tsx src/cli.ts list                  # every diagram type and its keywords
```

From the CLI, SVG output follows the viewer's light or dark setting unless `--dark` fixes it, and
`--inline` (or `-o x.html`) prints an `<img>` tag for a chat's HTML view, which follows the chat's
own setting. PNGs keep one palette.

The first word of a source picks the renderer. If one of our types claims that word, our renderer
draws it. Any other Mermaid type (sequence, class, ER, gantt, sankey…) goes to Mermaid 12, themed
with the same tokens. In Node, Mermaid runs in jsdom, with text measured from our font tables,
and resvg draws the PNG: no browser needed.

## Claude Code plugin

This repo is also a Claude Code plugin marketplace. Its `show-diagram` skill renders a diagram to PNG and
shows it beside the session: in a Rex or tmux pane (tmux needs `timg`), else in the system image viewer.

```sh
claude plugin marketplace add /path/to/mutant-mermaid
claude plugin install mutant-mermaid@mutant-mermaid
```

It needs Node 22.18 or newer, which runs the TypeScript source with nothing to build. The first render
installs the runtime packages with npm. To pick up changes to the renderer, bump the version in
`.claude-plugin/plugin.json` and run `claude plugin update mutant-mermaid@mutant-mermaid`.

## Diagram types

| Family | Keywords | Use it for |
|---|---|---|
| Templates | `pyramid` `funnel` | Hierarchies with a foundation; sales funnels |
| | `cycle` `flywheel` | Repeating stages (PDCA, water cycle), self-reinforcing loops |
| | `layers` (`style=onion`) | Stacks: OSI, tech stack, concentric scopes |
| | `matrix` `2x2` | Two-axis prioritisation, with quadrants and plotted points |
| | `canvas` `swot` | Grids of named regions with sticky notes |
| | `compare` `before-after` | Two to four columns side by side |
| | `spectrum` | Items placed between two poles |
| Reasoning | `mindmap` | Mind maps of linked cards (`style=elbow\|hairline\|organic` for other looks); cross-links with `~ A --> B`. Reads Mermaid mindmaps |
| | `argue` | Claim with `+` reasons for, `-` against, `?` open questions |
| | `tree` `issues` | MECE issue trees, left to right |
| Systems | `cld` | Causal loop diagrams; loops are found and classed R/B automatically |
| | `stockflow` | Stocks, flows with valves, auxiliaries, information links |
| Time | `timeline` | Lanes, eras, events and spans on a real axis, linear or log, from the Big Bang to next week. Reads Mermaid timelines |
| Flow | `flowchart` `graph` | Mermaid flowchart syntax on an ELK layout with rounded orthogonal edges |
| | `stateDiagram-v2` | Mermaid state diagram syntax |
| UI | `wireframe` `mockup` | Low-fidelity screens in a phone, tablet or browser frame |
| Mermaid | everything else | Sequence, class, ER, gantt, gitGraph, pie, sankey, quadrant, C4, kanban, … |

Examples of each are in [`examples/`](examples/). They double as the gallery and as visual tests.

## Syntax in one screen

```
pyramid "Maslow's hierarchy"           %% header: keyword, "title", key=value options
  Self-actualization : purpose          %% indented items; text after " : " is a note
  Esteem
  Physiological #amber                  %% #color: a palette name, an index or a hex value
```

- Indentation nests.
- `%%` starts a comment.
- After a label you can add `key=value` options, `!flags` and `#color`.
- `:name:` anywhere in a label draws that [Lucide icon](https://lucide.dev/icons) in the
  label's color, as in `:database: Postgres`. It works in every type, and in Mermaid labels too
  when rendered in Node. An unknown name stays as text, with a warning naming the closest icons.
  Mermaid `architecture-beta` services draw Lucide icons by the same names.
- A YAML frontmatter block can set `theme`, `dark`, `look` and `seed`.
- Coordinates are never needed: the layout is worked out for you.

```
cld "Product adoption"
  Adopters -> "Word of mouth" : +
  "Word of mouth" -> "Adoption rate" : +
  "Adoption rate" -> Adopters : +
  "Adoption rate" -> "Potential adopters" : -
  loop R "Word of mouth"
```

```
timeline "Atlas roadmap" now=2026-05-12
  era H1 2026-01 .. 2026-06 #sky
  lane Platform #blue
    span  Storage rewrite  2026-01 .. 2026-04
    milestone GA           2026-09-01 !major
```

Timeline dates can be:
- calendar dates: `2026-03-15`, `2026-03`, `March 2026`, `2026-Q2`;
- years, with negatives for BCE (`-27` is 27 BCE). Write years below 100 with an era, as in
  `11 CE`, so a label like `Apollo 11` isn't read as a date;
- `ka`, `Ma` or `Ga` offsets for deep time, counted back from `now`, or `BP`, counted back from
  1950.

Prefix a date with `~` for approximate or `?` for uncertain. A range is `1939 .. 1945`,
`1939 – 1945`, `1939 to 1945` or `1939-1945`. Options such as `!major` and `#red` can go before
or after the date.

Long timelines:
- `length=wide` lets the time axis grow until labels have room. The result scrolls instead of
  shrinking, and lane names stay pinned at the edge.
- `length=3000` sets the axis length in pixels. The default, `length=fit`, keeps it page-sized.
- `timeline TD "Title"` or `direction=vertical` runs time down the page, with lanes as columns.
  Mermaid-syntax timelines take `timeline TD` too.

```
wireframe "Sign in" device=phone          %% phone, tablet, browser (default) or none
  header
    icon back
    h3 Acme
  h1 Welcome back
  input Email : you@example.com           %% caption : placeholder
  row
    check Remember me !on
    spacer
    link Forgot password?
  button Sign in !primary !full
```

Wireframes:
- They show structure and affordances, not look and feel. Containers are outlined boxes, content
  text is drawn as grey bars, and widgets are placeholder marks. Words appear only where they name
  an action or a place: buttons, links, field names, nav items, tabs and checkbox labels.
- Containers: `row`, `col`, `grid cols=3`, `card Title`, `section`, `sidebar`, `header`, `footer`
  and `modal`. Rows and columns only arrange things and stay invisible; `!box` outlines them. A
  top-level `modal` floats over a shaded screen.
- Text: `h1`–`h3` and `text`, each bar as long as its words; `!small`, `!bold` and `!light` adjust
  it. `lines 3` is a paragraph of bars. A quoted label, `text "Free trial"`, is shown as written.
- Widgets: `link`, `button` (`!primary` is filled), `input`, `textarea`, `select`, `search`,
  `check`, `radio`, `toggle` (`!on`), `image`, `avatar`, `icon`, `logo`, `badge`,
  `chart bar|line|pie`, `divider` and `spacer`.
- `nav`, `tabs`, `list` rows and `table` rows split at ` | `. `[brackets]` mark the selected tab or
  row, or a nav item drawn as a button.
- Widths are worked out. Inputs, images and containers grow; buttons and labels keep their size.
  `w=`, `h=` and `!grow` override that.

## Themes and looks

- **Presets:** `meadow` (default, warm), `ink` (cool and technical), `dusk` (dark jewel tones),
  `paper` (muted earth tones), `candy` (bright). Each one also works with `--dark`.
- **Darker canvases:** `midnight` (blue-black, cool colors), `carbon` (untinted graphite) and
  `neon` open dark, on a canvas close to black. `phosphor` is Pod's amber terminal: warm black,
  amber type and bright CRT colors; its light variant is amber ink on warm paper.
- **High contrast:** `stark` (white and near-black, deep saturated lines; `--dark` flips it to
  black) and `neon` (bright lines on black). Text is at least 15:1 against the canvas, and lines
  at least 4.5:1.
- **Your own:** a partial theme takes `depth` (0 to 1, how close to black the dark canvas goes)
  and `contrast` (0 to 1), for example `{ name: 'meadow', contrast: 1 }`.
- **Editor palettes:** `gruvbox`, `dracula`, `nord`, `solarized`, `catppuccin`, `tokyo-night`,
  `rose-pine` and `one`.
  - Each uses its palette's exact colors. Fills are washes of those colors over the palette's
    background.
  - Each renders in its usual variant, which is dark for all except Solarized.
  - `dark: false` in frontmatter, or the gallery's toggle, switches to the palette's own light
    variant: Latte, Alucard, Dawn, Day and so on.
  - A `#color` written in a source snaps to the palette's nearest hue.
- **Looks:**
  - `clean` (the default) is crisp and precise.
  - `organic` softens curves where the meaning allows.
  - `sketch` adds a seeded hand-drawn wobble and paper grain.
  - `boxy` is crisp like `clean`, with square corners on every box, bar, pill and bend. Circles
    stay round, and so do flowchart shapes whose roundness means something (stadium, circle,
    database).
- **Shape follows meaning:** pyramids, matrices and timelines stay geometric. Mind maps and
  feedback loops curve.

## API

```ts
import { render } from 'mutant-mermaid'                                  // browser or Node: SVG
import { renderAuto, engineToPng, closeEngines } from 'mutant-mermaid/node' // Node: any type → PNG
import { renderMermaid, mermaidConfig } from 'mutant-mermaid/mermaid'     // themed Mermaid only

const { svg } = await render(source, { theme: 'dusk', look: 'sketch' })
```

To match a host app, build a theme from its colors (any CSS color strings, resolved, not
`var()`), and pass it to either renderer:

```ts
import { themeFromColors } from 'mutant-mermaid'
const theme = themeFromColors({ bg, fg, accent, colors, surface, muted }, { dark: true })
await render(source, { theme })
await renderMermaid({ source, theme })
```

Semantic roles (`positive`, `negative`, `caution`, `reinforcing`, `balancing`) are picked from
`colors` by hue unless `roles` names them.

The package exports the compiled `dist/` (ESM with `.d.ts`); `pnpm build` makes it, and
`pnpm install` runs that. `mermaid@12` is an optional peer dependency, needed only for
stock Mermaid types. `playwright` is optional too: only `pnpm mermaid:snapshots` uses it, to
render Chromium references that `--jsdom` renders are checked against.

Rendering is deterministic: the same source gives the same SVG. When a source can't be parsed, the
error message gives the line number and says how to fix it, so an agent can correct the source and
try again.

## More

- [`docs/AGENTS.md`](docs/AGENTS.md): how an AI agent should pick a type, write the source and check
  the result.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): the pipeline, how to add a type, design rules.
