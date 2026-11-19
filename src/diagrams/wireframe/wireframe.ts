import { roundedRect } from '../../core/geometry.ts'
import { clickSyntax } from '../../core/hooks.ts'
import { g, h, n } from '../../core/svg.ts'
import type { Context, DiagramType, Drawing } from '../../core/types.ts'
import { alpha } from '../../theme/index.ts'
import { Bounds, frame, sayer, uid } from '../templates/common.ts'
import { type Box, type Env, place, shift } from './layout.ts'
import type { Device, Element, WireframeModel } from './model.ts'
import { elementIds, paint } from './paint.ts'
import { parseWireframe } from './parse.ts'

/**
 * A low-fidelity screen: nested boxes, grey bars for text and placeholder marks for widgets, so
 * the structure and the affordances read without any look and feel:
 *
 *   wireframe "Sign in" device=phone
 *     header
 *       logo Acme
 *       icon menu
 *     h1 Welcome back
 *     input Email : you@example.com
 *     button Sign in !primary
 *
 * Headers and footers run edge to edge; everything between them is gathered into a padded main
 * column. A top-level `modal` floats over a shaded screen. The device is only hinted at: an
 * outline with a notch for a phone, a toolbar for a browser.
 */

interface Outline {
  /** Strip above the content holding the device hint: a notch, a camera or a toolbar. */
  bar: number
  radius: number
  /** The least content height, so a short screen still reads as a whole device. */
  minimum: number
}

const OUTLINES: Record<Device, Outline> = {
  phone: { bar: 28, radius: 30, minimum: 640 },
  tablet: { bar: 22, radius: 20, minimum: 720 },
  browser: { bar: 38, radius: 8, minimum: 520 },
  none: { bar: 0, radius: 4, minimum: 0 },
}

/** Top-level elements that run edge to edge instead of sitting in the padded main column. */
function isChrome(el: Element): boolean {
  if (el.kind === 'header' || el.kind === 'footer') return true
  if (el.kind === 'main') return true
  return el.kind === 'row' && el.children.some((c) => c.kind === 'sidebar')
}

function mainOf(children: Element[]): Element {
  return {
    kind: 'main',
    label: '',
    parts: [],
    attrs: {},
    flags: new Set(),
    rows: [],
    children,
    line: children[0]?.line ?? 1,
  }
}

/** Gathers runs of ordinary elements into main columns between the edge-to-edge chrome. */
export function gather(elements: Element[]): Element[] {
  const out: Element[] = []
  let run: Element[] = []
  for (const el of elements) {
    if (!isChrome(el)) {
      run.push(el)
      continue
    }
    if (run.length) out.push(mainOf(run))
    run = []
    out.push(el)
  }
  if (run.length) out.push(mainOf(run))
  return out
}

/** Gives a box extra height; a row holding a sidebar passes it on to its columns. */
function grow({ box, extra }: { box: Box; extra: number }): Box {
  const kids = box.el.kind === 'row' ? box.kids.map((k) => ({ ...k, h: k.h + extra })) : box.kids
  return { ...box, h: box.h + extra, kids }
}

/**
 * Lays the screen out top to bottom. When it's shorter than the device, the space goes to the
 * last region before a closing footer, so the footer sits at the bottom.
 */
function layoutFlow({ env, model }: { env: Env; model: WireframeModel }): Box[] {
  const minimum = OUTLINES[model.device].minimum
  const flow = gather(model.elements.filter((el) => el.kind !== 'modal'))
  const boxes: Box[] = []
  let y = 0
  for (const el of flow) {
    const box = place({ env, el, x: 0, y, w: model.width, align: 'start' })
    boxes.push(box)
    y += box.h
  }
  const extra = minimum - y
  if (extra <= 0 || !boxes.length) return boxes
  const footer = boxes[boxes.length - 1].el.kind === 'footer' ? boxes.length - 1 : boxes.length
  const target = Math.max(0, footer - 1)
  return boxes.map((box, i) => {
    if (i === target) return grow({ box, extra })
    return i > target ? shift({ box, dy: extra }) : box
  })
}

function screenHeight(boxes: Box[]): number {
  return boxes.reduce((most, b) => Math.max(most, b.y + b.h), 0)
}

function layoutModals({ env, model, height }: { env: Env; model: WireframeModel; height: number }) {
  return model.elements
    .filter((el) => el.kind === 'modal')
    .map((el) => {
      const w = Math.min(Number(el.attrs.w) || 440, model.width - 48)
      const box = place({ env, el, x: (model.width - w) / 2, y: 0, w, align: 'start' })
      return shift({ box, dy: Math.max(24, (height - box.h) / 2) })
    })
}

/** A browser toolbar: three dots and an address box, with the page's address when it's given. */
function toolbar({ ctx, model }: { ctx: Context; model: WireframeModel }): string {
  const { tokens } = ctx
  const bar = OUTLINES.browser.bar
  const address = { x: 76, y: 8, w: Math.min(model.width - 152, 480), h: bar - 16, r: 4 }
  const label = model.url
    ? sayer(ctx.text)({
        x: address.x + 10,
        y: bar / 2,
        lines: [model.url],
        size: 12,
        fill: tokens.muted,
        anchor: 'start',
      })
    : h('rect', {
        x: address.x + 10,
        y: bar / 2 - 3,
        width: 120,
        height: 6,
        rx: 3,
        fill: tokens.border,
      })
  return g(
    {},
    h('path', { d: `M0 ${n(bar)}H${n(model.width)}`, stroke: tokens.faint, 'stroke-width': 1.3 }),
    ...[0, 1, 2].map((i) =>
      h('circle', {
        cx: 18 + i * 15,
        cy: bar / 2,
        r: 4.5,
        fill: 'none',
        stroke: tokens.faint,
        'stroke-width': 1.2,
      }),
    ),
    h('path', { d: roundedRect(address), fill: 'none', stroke: tokens.faint, 'stroke-width': 1.2 }),
    label,
  )
}

/** A phone's notch or a tablet's camera, centered in the top strip. */
function deviceHint({ ctx, model }: { ctx: Context; model: WireframeModel }): string {
  const { bar } = OUTLINES[model.device]
  const stroke = ctx.tokens.faint
  if (model.device === 'browser') return toolbar({ ctx, model })
  if (model.device === 'phone')
    return h('path', {
      d: `M${n(model.width / 2 - 28)} ${n(bar / 2)}H${n(model.width / 2 + 28)}`,
      stroke,
      'stroke-width': 5,
      'stroke-linecap': 'round',
    })
  if (model.device === 'tablet')
    return h('circle', { cx: model.width / 2, cy: bar / 2, r: 3, fill: stroke })
  return ''
}

/** Shades the page behind a modal; a browser's toolbar stays clear, since it isn't the page. */
function backdrop({ ctx, model, height }: { ctx: Context; model: WireframeModel; height: number }) {
  const top = model.device === 'browser' ? OUTLINES.browser.bar : 0
  return h('rect', {
    y: top,
    width: model.width,
    height: height - top,
    fill: alpha({ color: ctx.tokens.fg, amount: 0.08 }),
  })
}

/** The screen in its own coordinates: the device strip on top, then the content. */
function screen({ ctx, model }: { ctx: Context; model: WireframeModel }) {
  const env = { kit: ctx.text }
  const { bar } = OUTLINES[model.device]
  const flow = layoutFlow({ env, model })
  const content = screenHeight(flow)
  const modals = layoutModals({ env, model, height: content })
  const height = bar + content
  const ids = elementIds(model.elements)
  const body = g(
    {},
    h('rect', { width: model.width, height, fill: ctx.tokens.surface }),
    g({ y: bar }, ...flow.map((box) => paint({ ctx, box, ids }))),
    deviceHint({ ctx, model }),
    modals.length ? backdrop({ ctx, model, height }) : '',
    g({ y: bar }, ...modals.map((box) => paint({ ctx, box, ids }))),
  )
  return { body, height }
}

function device({ ctx, model }: { ctx: Context; model: WireframeModel }) {
  const shown = screen({ ctx, model })
  const { radius } = OUTLINES[model.device]
  const edge = { x: 0, y: 0, w: model.width, h: shown.height, r: radius }
  const clip = uid({ ctx, prefix: 'wf-screen' })
  const body = g(
    {},
    g({ 'clip-path': `url(#${clip})` }, shown.body),
    h('path', { d: roundedRect(edge), fill: 'none', stroke: ctx.tokens.muted, 'stroke-width': 2 }),
  )
  const defs = h('clipPath', { id: clip }, h('path', { d: roundedRect(edge) }))
  return { body, defs, w: edge.w, h: edge.h }
}

export function renderWireframe(model: WireframeModel, ctx: Context): Drawing {
  const drawn = device({ ctx, model })
  const bounds = new Bounds()
  bounds.add({ x: 0, y: 0, w: drawn.w, h: drawn.h })
  const ink = ctx.tokens.look === 'sketch' ? 'url(#mm-ink)' : undefined
  const body = g({ filter: ink }, drawn.body)
  return frame({ ctx, title: model.title, body, bounds, defs: drawn.defs })
}

export const wireframe: DiagramType<WireframeModel> = {
  id: 'wireframe',
  keywords: ['wireframe', 'mockup', 'screen'],
  title: 'Wireframe',
  summary:
    'A low-fidelity screen of nested boxes, text bars and placeholder widgets, for structure and affordances rather than look and feel.',
  guide: {
    useWhen: 'the point is a screen’s structure and affordances, not its look and feel.',
    syntax: `
One element per line. Indent a line under a container to put it inside:

\`\`\`
wireframe "Pricing" device=phone        %% phone, tablet, browser (default) or none
  header                                %% edge-to-edge bar; its children sit in a row
    logo Acme
    nav Plans | [Sign in]               %% items as words; [x] is drawn as a button
  h1 Plans for every team               %% content text: a grey bar, not words
  text "Free for 14 days" !small        %% quoted: shown as written
  lines 3                               %% a paragraph of 3 bars
  card Starter                          %% outlined box; its title is a bar (quote it for words)
    input Email : you@example.com       %% field name : placeholder
    button Start trial !primary !full
  row align=end                         %% side by side, invisible unless !box
    link Compare plans
  footer align=center
    link Terms
  modal Confirm                         %% top-level: floats over a shaded screen
    button OK
\`\`\`

- **Words or bars, the main rule.** Only text that names an action or a place is drawn as words:
  button labels, links, \`nav\` items, \`tabs\`, \`check\`/\`radio\`/\`toggle\` labels, the
  names of \`input\`, \`select\`, \`textarea\` and \`search\`, and an \`image\` caption. All other
  text becomes a grey bar as long as its words: \`h1\`–\`h3\`, \`text\`, card, section and modal
  titles, list and table cells, \`badge\`, \`avatar\` and \`logo\` names, and placeholders. An
  \`icon\`'s name isn't drawn at all. Write realistic words anyway, since they set each bar's length.
- **Quotes show the words:** \`h1 "Welcome"\`, \`text "Free trial"\` or \`card "Starter"\` is drawn
  as written. This works on \`h1\`–\`h3\`, \`text\`, and card, section and modal titles. \`!small\`
  makes text smaller, \`!bold\` heavier and darker, \`!light\` (or \`!muted\`) keeps a bar pale.
  Plain \`text\` with no words draws one stock line.
- **Header options:** \`device=\` \`phone\` (or \`mobile\`), \`tablet\` (\`ipad\`), \`browser\`
  (\`desktop\`, \`web\`) or \`none\` (\`plain\`). The default is \`browser\`; an unknown device
  warns and uses \`browser\`. Widths are 375, 768, 1024 and 640; \`width=1100\` overrides.
  \`url=app.acme.io/home\` is shown in the browser's address bar, and only there.
- **Element words**, case-insensitive. Containers: \`row\` (\`hstack\`), \`col\` (\`column\`,
  \`stack\`, \`vstack\`), \`grid\`, \`card\` (\`panel\`, \`box\`), \`section\`, \`sidebar\`
  (\`aside\`), \`header\` (\`navbar\`, \`topbar\`, \`appbar\`), \`footer\`, \`main\` (\`content\`,
  \`body\`), \`modal\` (\`dialog\`). Widgets: \`h1\` (\`title\`), \`h2\` (\`heading\`), \`h3\`
  (\`subheading\`), \`text\` (\`p\`, \`para\`, \`paragraph\`, \`label\`), \`lines\`, \`link\`
  (\`a\`), \`button\` (\`btn\`), \`input\` (\`field\`, \`email\`, \`password\`), \`textarea\`,
  \`select\` (\`dropdown\`), \`search\`, \`check\` (\`checkbox\`), \`radio\`, \`toggle\`
  (\`switch\`), \`image\` (\`img\`, \`photo\`, \`picture\`, \`video\`, \`map\`), \`avatar\`, \`icon\`,
  \`logo\`, \`badge\` (\`chip\`, \`tag\`, \`pill\`), \`nav\` (\`menu\`, \`links\`), \`tabs\` (\`tab\`),
  \`list\`, \`table\`, \`chart\`, \`divider\` (\`hr\`, \`separator\`, \`---\`), \`spacer\` (\`space\`,
  \`gap\`).
- **An unknown first word** makes the whole line a \`text\` bar, with a warning. Lines indented
  under a widget (anything not a container, \`list\` or \`table\`) are dropped, with a warning: put
  them in a \`row\`, \`col\` or \`card\` instead.
- **The screen:** a top-level \`header\`, \`footer\`, \`main\`, or \`row\` holding a \`sidebar\` runs
  edge to edge. Everything else at the top level is gathered into a padded main column between
  them. A short screen is stretched to the device's height, so a last \`footer\` sits at the bottom.
  A top-level \`modal\` floats centered over a shaded screen, 440 wide (\`w=\` changes it) or the
  screen's width, if that's narrower; nested,
  it's just an outlined box.
- **Containers:** \`card\` is outlined and \`section\` dashed; a label on either, or on a
  \`modal\`, becomes a title bar on top. \`header\` and \`footer\` are outlined strips that lay their
  children in a row; without \`align=\`, the last child is pushed to the far edge. \`sidebar\` is
  220 wide. \`row\`, \`col\`, \`grid\` and \`main\` only arrange things and stay invisible; \`!box\`
  outlines a row or column. \`grid cols=3\` wraps its children into equal cells (default: up to
  3 per row).
- **Widths:** in a column, buttons, links, checks, radios, toggles, badges, icons, avatars, logos
  and navs keep their own width; everything else is full width. In a row, those, text and
  headings keep their own width, and inputs, selects, textareas, search, images, lines, lists, tables, charts,
  tabs, dividers, spacers and containers share what's left. A \`spacer\` in a row pushes what
  follows to the far end. \`!grow\` or \`!full\` makes anything stretch, \`grow=2\` gives a stretching
  element twice the share, \`w=200\` fixes the width (and stops stretching), \`h=120\` the height.
- **Alignment:** \`align=start|center|end\` (or \`!center\`) on a container aligns its children:
  across a column, or the whole group along a row. It does nothing on a widget.
- **Fields:** \`input Email : you@example.com\` puts the name above the box and a bar for the
  placeholder inside. Without \` : \`, the name is shown inside, in placeholder grey. The same goes
  for \`select\` and \`textarea\`. Only those three use \` : \`; on every other element the colon
  stays in the text. \`search Find events\` shows all its text as the placeholder. Group radios
  by putting them in a \`card\` or \`col\`: there's no group element.
- **Widget options:** \`button !primary\` is filled, \`button !ghost\` dashed. \`input !secret\` (and
  \`password\`) shows masked dots. \`image !play\` (and \`video\`) puts a play button over the
  image. \`check\`, \`radio\` and \`toggle\` take \`!on\`
  (or \`!checked\`, \`!selected\`). \`image Caption ratio=1.6\` (default 16:9). \`avatar size=48\`.
  \`chart pie\` or \`donut\`, \`chart line\` or \`area\`; anything else draws bars. \`lines 5\` is
  1 to 12 bars, 3 by default.
- **Parts split at \` | \`** in \`nav\`, \`tabs\`, and each row under \`list\` or \`table\` (those
  rows are plain text lines, not elements). A \`nav\` always runs in a row, even in a
  \`sidebar\`; for a vertical menu, write one \`link\` per line. \`[Brackets]\` mark one: a nav item drawn as a button,
  the selected tab (the first one otherwise), or a highlighted list row. A table's first row is
  its header.
- **Options go at the end of the line.** A trailing \`key=value\` or \`!flag\` is read as an
  option and taken out of the text. Unknown flags are ignored silently. A \`#color\` warns:
  wireframes are greys only. \`@\`, \`#\` inside words, and colons are kept as written.
${clickSyntax('An element goes by its `id=` option (`button Start trial id=start`), or else by its text as a lowercase slug (`start-trial`), or its element word when it has no text; a repeat gets `-2`, `-3`. Give `id=` to anything a click line names, so rewording it keeps the hook.')}`,
    example: `
wireframe "Sign in" device=phone
  header
    icon back
    h3 Acme
    icon more
  image Welcome illustration ratio=1.6
  h1 Welcome back
  text Sign in to pick up where you left off.
  input Email : you@example.com
  input Password : Your password
  row
    check Remember me !on
    spacer
    link Forgot password?
  button Sign in !primary !full
  row align=center
    text "or" !small
  button Continue with Google !full
  footer align=center
    text "New here?"
    link Create an account`,
  },
  parse: parseWireframe,
  render: renderWireframe,
}
