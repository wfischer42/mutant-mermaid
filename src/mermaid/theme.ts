/**
 * Our Mermaid theme: every Mermaid 12 diagram type drawn from the same OKLCH tokens as our own
 * renderers. Mermaid only understands hex (it runs its own color math on the values), and the
 * tokens are hex already.
 */
import { mix, OUTLINE, type Swatch, type Tokens, toned, WEIGHT } from '../theme/index.ts'

export const MERMAID_FONT_SIZE = 14

/** How many colors Mermaid's categorical scales take (timeline sections, mindmap branches, …). */
const SCALE = 12

export type MermaidConfig = Record<string, unknown>

/** The swatch for the i-th category, wrapping round the palette. */
function category({ tokens, index }: { tokens: Tokens; index: number }): Swatch {
  const { palette } = tokens
  return palette[((index % palette.length) + palette.length) % palette.length]
}

/** A swatch for a named hue, at the theme's lightness, for roles Mermaid gives a fixed meaning. */
function role({ tokens, hue }: { tokens: Tokens; hue: number }): Swatch {
  return toned({ tokens, hue })
}

/**
 * A solid color between a swatch's area and line tones: strong enough to read as a slice or a
 * bar, light enough (in light mode) or deep enough (in dark mode) for the theme's text on it.
 */
export function solid({ tokens, sw }: { tokens: Tokens; sw: Swatch }): string {
  if (tokens.dark) return mix({ from: sw.soft, to: sw.stroke, amount: 0.45 })
  return mix({ from: sw.fill, to: sw.stroke, amount: 0.55 })
}

/** cScale, pie and surface: the twelve-step categorical scales, from the palette. */
function scales(tokens: Tokens): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < SCALE; i++) {
    const sw = category({ tokens, index: i })
    const second = i >= tokens.palette.length
    out[`cScale${i}`] = second ? sw.soft : sw.fill
    out[`cScalePeer${i}`] = sw.stroke
    out[`cScaleInv${i}`] = sw.stroke
    out[`cScaleLabel${i}`] = sw.ink
    out[`pie${i + 1}`] = solid({ tokens, sw })
    out[`surface${i}`] = sw.fill
    out[`surfacePeer${i}`] = sw.soft
  }
  return out
}

/** git, fillType (journey) and venn: the eight-step scales. */
function shortScales(tokens: Tokens): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < 8; i++) {
    const sw = category({ tokens, index: i })
    out[`git${i}`] = tokens.dark ? sw.stroke : sw.strong
    out[`gitInv${i}`] = sw.fill
    out[`gitBranchLabel${i}`] = tokens.dark ? tokens.bg : tokens.surface
    out[`fillType${i}`] = sw.fill
    out[`venn${i + 1}`] = sw.stroke
  }
  return out
}

/** The canvas, type and plain text. */
function canvas(tokens: Tokens): Record<string, unknown> {
  return {
    darkMode: tokens.dark,
    background: tokens.bg,
    fontFamily: tokens.font.family,
    fontSize: `${MERMAID_FONT_SIZE}px`,
    useGradient: false,
    dropShadow: 'none',
    strokeWidth: OUTLINE.thin,
    textColor: tokens.fg,
    titleColor: tokens.fg,
    labelColor: tokens.fg,
    lineColor: tokens.muted,
    arrowheadColor: tokens.muted,
    defaultLinkColor: tokens.muted,
    edgeLabelBackground: tokens.bg,
    labelBackground: tokens.bg,
    border2: tokens.border,
    clusterBkg: tokens.sunken,
    clusterBorder: tokens.border,
    flowContainerStroke: tokens.border,
  }
}

/** Primary, secondary and tertiary: the colors Mermaid derives most others from. */
function nodes(tokens: Tokens): Record<string, unknown> {
  const { accent } = tokens
  const second = category({ tokens, index: 1 })
  const third = category({ tokens, index: 2 })
  return {
    primaryColor: accent.fill,
    primaryTextColor: tokens.fg,
    primaryBorderColor: accent.stroke,
    secondaryColor: second.fill,
    secondaryTextColor: tokens.fg,
    secondaryBorderColor: second.stroke,
    tertiaryColor: third.fill,
    tertiaryTextColor: tokens.fg,
    tertiaryBorderColor: third.stroke,
    mainBkg: accent.fill,
    secondBkg: second.fill,
    nodeBkg: accent.fill,
    nodeBorder: accent.stroke,
    nodeTextColor: accent.ink,
    border1: accent.stroke,
    gradientStart: accent.stroke,
    gradientStop: second.stroke,
  }
}

function notes(tokens: Tokens): Record<string, string> {
  const { semantic } = tokens
  return {
    noteBkgColor: semantic.caution.fill,
    noteTextColor: semantic.caution.ink,
    noteBorderColor: semantic.caution.stroke,
    errorBkgColor: semantic.negative.fill,
    errorTextColor: semantic.negative.ink,
  }
}

function sequence(tokens: Tokens): Record<string, string> {
  const { accent } = tokens
  const active = category({ tokens, index: 1 })
  return {
    actorBkg: accent.fill,
    actorBorder: accent.stroke,
    actorTextColor: accent.ink,
    actorLineColor: tokens.faint,
    signalColor: tokens.muted,
    signalTextColor: tokens.fg,
    labelBoxBkgColor: tokens.sunken,
    labelBoxBorderColor: tokens.border,
    labelTextColor: tokens.fg,
    loopTextColor: tokens.muted,
    activationBkgColor: active.soft,
    activationBorderColor: active.stroke,
    sequenceNumberColor: tokens.bg,
    personBkg: accent.fill,
    personBorder: accent.stroke,
  }
}

function classAndState(tokens: Tokens): Record<string, string> {
  const { accent } = tokens
  return {
    classText: accent.ink,
    stateBkg: accent.fill,
    stateLabelColor: accent.ink,
    labelBackgroundColor: tokens.bg,
    compositeBackground: tokens.sunken,
    compositeTitleBackground: accent.fill,
    compositeBorder: tokens.border,
    altBackground: tokens.surface,
    innerEndBackground: tokens.fg,
    specialStateColor: tokens.fg,
    transitionColor: tokens.muted,
    transitionLabelColor: tokens.fg,
    rowOdd: tokens.surface,
    rowEven: tokens.sunken,
    attributeBackgroundColorOdd: tokens.surface,
    attributeBackgroundColorEven: tokens.sunken,
    relationColor: tokens.muted,
    relationLabelBackground: tokens.bg,
    relationLabelColor: tokens.fg,
    requirementBackground: tokens.surface,
    requirementBorderColor: accent.stroke,
    requirementBorderSize: '1.5',
    requirementTextColor: tokens.fg,
  }
}

function gantt(tokens: Tokens): Record<string, string> {
  const { accent, semantic } = tokens
  const active = category({ tokens, index: 1 })
  return {
    sectionBkgColor: tokens.sunken,
    altSectionBkgColor: tokens.bg,
    sectionBkgColor2: tokens.sunken,
    excludeBkgColor: tokens.sunken,
    gridColor: tokens.border,
    taskBkgColor: accent.soft,
    taskBorderColor: accent.stroke,
    taskTextColor: accent.ink,
    taskTextLightColor: accent.ink,
    taskTextDarkColor: tokens.fg,
    taskTextOutsideColor: tokens.fg,
    taskTextClickableColor: accent.strong,
    activeTaskBkgColor: active.soft,
    activeTaskBorderColor: active.stroke,
    doneTaskBkgColor: tokens.border,
    doneTaskBorderColor: tokens.faint,
    critBkgColor: semantic.negative.soft,
    critBorderColor: semantic.negative.stroke,
    todayLineColor: semantic.negative.stroke,
    vertLineColor: tokens.muted,
  }
}

function pie(tokens: Tokens): Record<string, string> {
  return {
    pieTitleTextSize: '20px',
    pieTitleTextColor: tokens.fg,
    pieSectionTextSize: `${MERMAID_FONT_SIZE}px`,
    pieSectionTextColor: tokens.fg,
    pieLegendTextSize: `${MERMAID_FONT_SIZE}px`,
    pieLegendTextColor: tokens.fg,
    pieStrokeColor: tokens.bg,
    pieStrokeWidth: '2px',
    pieOuterStrokeWidth: '0px',
    pieOuterStrokeColor: tokens.bg,
    pieOpacity: '1',
  }
}

function quadrant(tokens: Tokens): Record<string, string> {
  const fills = [1, 0, 4, 3].map((index) => category({ tokens, index }).fill)
  return {
    quadrant1Fill: fills[0],
    quadrant2Fill: fills[1],
    quadrant3Fill: fills[2],
    quadrant4Fill: fills[3],
    quadrant1TextFill: tokens.fg,
    quadrant2TextFill: tokens.fg,
    quadrant3TextFill: tokens.fg,
    quadrant4TextFill: tokens.fg,
    quadrantPointFill: tokens.accent.strong,
    quadrantPointTextFill: tokens.fg,
    quadrantTitleFill: tokens.fg,
    quadrantXAxisTextFill: tokens.muted,
    quadrantYAxisTextFill: tokens.muted,
    quadrantInternalBorderStrokeFill: tokens.bg,
    quadrantExternalBorderStrokeFill: tokens.border,
  }
}

function git(tokens: Tokens): Record<string, string> {
  return {
    branchLabelColor: tokens.dark ? tokens.bg : tokens.surface,
    tagLabelColor: tokens.fg,
    tagLabelBackground: tokens.semantic.caution.fill,
    tagLabelBorder: tokens.semantic.caution.stroke,
    tagLabelFontSize: '11px',
    commitLabelColor: tokens.muted,
    commitLabelBackground: tokens.bg,
    commitLabelFontSize: '11px',
  }
}

function architecture(tokens: Tokens): Record<string, string> {
  return {
    archEdgeColor: tokens.muted,
    archEdgeArrowColor: tokens.muted,
    archEdgeWidth: '2',
    archGroupBorderColor: tokens.faint,
    archGroupBorderWidth: '1.5px',
    vennTitleTextColor: tokens.fg,
    vennSetTextColor: tokens.fg,
  }
}

/** Event modeling: the four roles keep the colors event-modeling boards use (blue, orange, …). */
function eventModeling(tokens: Tokens): Record<string, string> {
  const command = role({ tokens, hue: 250 })
  const event = role({ tokens, hue: 55 })
  const readModel = role({ tokens, hue: 140 })
  const processor = role({ tokens, hue: 310 })
  return {
    emUiFill: tokens.surface,
    emUiStroke: tokens.border,
    emCommandFill: command.soft,
    emCommandStroke: command.stroke,
    emEventFill: event.soft,
    emEventStroke: event.stroke,
    emReadModelFill: readModel.soft,
    emReadModelStroke: readModel.stroke,
    emProcessorFill: processor.soft,
    emProcessorStroke: processor.stroke,
    emSwimlaneBackgroundOdd: tokens.sunken,
    emSwimlaneBackgroundStroke: tokens.border,
    emArrowhead: tokens.muted,
    emRelationStroke: tokens.muted,
  }
}

function usecase(tokens: Tokens): Record<string, string> {
  const { accent } = tokens
  return {
    usecaseActorBkg: tokens.surface,
    usecaseActorBorder: tokens.muted,
    usecaseBkg: accent.fill,
    usecaseBorder: accent.stroke,
    usecaseBoundaryBkg: tokens.sunken,
    usecaseBoundaryBorder: tokens.border,
    usecaseIncludeLine: tokens.muted,
    usecaseExtendLine: tokens.muted,
  }
}

function xyChart(tokens: Tokens): Record<string, string> {
  return {
    backgroundColor: tokens.bg,
    titleColor: tokens.fg,
    dataLabelColor: tokens.fg,
    legendTextColor: tokens.fg,
    xAxisTitleColor: tokens.muted,
    xAxisLabelColor: tokens.muted,
    xAxisTickColor: tokens.faint,
    xAxisLineColor: tokens.faint,
    yAxisTitleColor: tokens.muted,
    yAxisLabelColor: tokens.muted,
    yAxisTickColor: tokens.faint,
    yAxisLineColor: tokens.faint,
    plotColorPalette: tokens.palette.map((sw) => sw.stroke).join(', '),
  }
}

function radar(tokens: Tokens): Record<string, unknown> {
  return {
    axisColor: tokens.faint,
    axisStrokeWidth: 1,
    axisLabelFontSize: 13,
    curveOpacity: 0.18,
    curveStrokeWidth: 2,
    graticuleColor: tokens.border,
    graticuleStrokeWidth: 1,
    graticuleOpacity: 0.25,
    legendBoxSize: 12,
    legendFontSize: 13,
  }
}

function packet(tokens: Tokens): Record<string, string> {
  const { accent } = tokens
  return {
    byteFontSize: '10px',
    startByteColor: tokens.muted,
    endByteColor: tokens.muted,
    labelColor: accent.ink,
    labelFontSize: '13px',
    titleColor: tokens.fg,
    titleFontSize: '16px',
    blockStrokeColor: accent.stroke,
    blockStrokeWidth: '1.5',
    blockFillColor: accent.fill,
  }
}

function treemap(tokens: Tokens): Record<string, string> {
  return {
    sectionStrokeColor: tokens.border,
    sectionStrokeWidth: '1',
    sectionFillColor: tokens.sunken,
    leafStrokeColor: tokens.bg,
    leafStrokeWidth: '2',
    leafFillColor: tokens.accent.fill,
    labelFontSize: '13px',
    valueFontSize: '11px',
    titleFontSize: '16px',
    titleColor: tokens.fg,
    labelColor: tokens.fg,
    valueColor: tokens.muted,
  }
}

function treeView(tokens: Tokens): Record<string, string> {
  return {
    labelFontSize: `${MERMAID_FONT_SIZE}px`,
    labelColor: tokens.fg,
    lineColor: tokens.faint,
    iconColor: tokens.muted,
    descriptionColor: tokens.muted,
    highlightBg: tokens.accent.fill,
    highlightStroke: tokens.accent.stroke,
  }
}

function wardley(tokens: Tokens): Record<string, string> {
  return {
    backgroundColor: tokens.bg,
    axisColor: tokens.muted,
    axisTextColor: tokens.muted,
    gridColor: tokens.border,
    componentFill: tokens.surface,
    componentStroke: tokens.fg,
    componentLabelColor: tokens.fg,
    linkStroke: tokens.faint,
    evolutionStroke: tokens.semantic.negative.stroke,
    annotationStroke: tokens.muted,
    annotationTextColor: tokens.fg,
    annotationFill: tokens.surface,
  }
}

function cynefin(tokens: Tokens): Record<string, unknown> {
  return {
    domainFontSize: 16,
    itemFontSize: 13,
    boundaryColor: tokens.faint,
    boundaryWidth: 1.5,
    cliffColor: tokens.semantic.negative.stroke,
    cliffWidth: 3,
    arrowColor: tokens.muted,
    arrowWidth: 1.5,
    complexBg: category({ tokens, index: 1 }).fill,
    complicatedBg: category({ tokens, index: 2 }).fill,
    chaoticBg: category({ tokens, index: 0 }).fill,
    clearBg: category({ tokens, index: 3 }).fill,
    confusionBg: tokens.sunken,
    textColor: tokens.fg,
    labelColor: tokens.fg,
  }
}

function railroad(tokens: Tokens): Record<string, unknown> {
  const { accent, semantic } = tokens
  const terminal = category({ tokens, index: 1 })
  return {
    fontFamily: tokens.font.family,
    fontSize: MERMAID_FONT_SIZE,
    terminalFill: terminal.fill,
    terminalStroke: terminal.stroke,
    terminalTextColor: terminal.ink,
    nonTerminalFill: accent.fill,
    nonTerminalStroke: accent.stroke,
    nonTerminalTextColor: accent.ink,
    lineColor: tokens.muted,
    strokeWidth: OUTLINE.thin,
    markerFill: tokens.muted,
    commentFill: tokens.sunken,
    commentStroke: tokens.border,
    commentTextColor: tokens.muted,
    specialFill: semantic.caution.fill,
    specialStroke: semantic.caution.stroke,
    ruleNameColor: tokens.fg,
  }
}

/** The diagrams that read their colors from a nested object of their own. */
function nested(tokens: Tokens): Record<string, unknown> {
  return {
    xyChart: xyChart(tokens),
    radar: radar(tokens),
    packet: packet(tokens),
    treemap: treemap(tokens),
    treeView: treeView(tokens),
    wardley: wardley(tokens),
    wardleyEvolutionColor: tokens.semantic.negative.stroke,
    cynefin: cynefin(tokens),
    railroad: railroad(tokens),
  }
}

/** Every Mermaid theme variable, from tokens. */
export function themeVariables(tokens: Tokens): Record<string, unknown> {
  return {
    ...canvas(tokens),
    ...nodes(tokens),
    ...notes(tokens),
    ...sequence(tokens),
    ...classAndState(tokens),
    ...gantt(tokens),
    ...scales(tokens),
    ...shortScales(tokens),
    ...pie(tokens),
    ...quadrant(tokens),
    ...git(tokens),
    ...architecture(tokens),
    ...eventModeling(tokens),
    ...usecase(tokens),
    ...nested(tokens),
  }
}

/** C4 colors and fonts live in its diagram config, not in theme variables. */
function c4(tokens: Tokens): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const kinds = ['person', 'system', 'system_db', 'system_queue', 'container', 'container_db']
  const more = ['container_queue', 'component', 'component_db', 'component_queue']
  for (const kind of [...kinds, ...more]) {
    const sw = kind === 'person' ? tokens.accent : category({ tokens, index: 2 })
    out[`${kind}_bg_color`] = sw.fill
    out[`${kind}_border_color`] = sw.stroke
    out[`external_${kind}_bg_color`] = tokens.sunken
    out[`external_${kind}_border_color`] = tokens.faint
    for (const name of [kind, `external_${kind}`]) {
      out[`${name}FontFamily`] = tokens.font.family
      out[`${name}FontSize`] = MERMAID_FONT_SIZE
    }
  }
  for (const name of ['boundary', 'message']) out[`${name}FontFamily`] = tokens.font.family
  return { ...out, boundaryFontSize: 13, messageFontSize: 12, wrap: true }
}

/** Edge labels sit on the solid canvas, so a line behind a label is hidden, not half-seen. */
function labelCSS(tokens: Tokens): string[] {
  return [
    `.edgeLabel rect, .labelBkg, .relationshipLabelBox, .relationshipLabelBox rect { fill: ${tokens.bg} !important; background: ${tokens.bg} !important; opacity: 1 !important; }`,
    `.edgeLabel text, .edgeLabel tspan, .relationshipLabel { fill: ${tokens.fg} !important; }`,
    `.node text, .node tspan { fill: ${tokens.accent.ink}; }`,
    `.cluster-label text, .cluster text { fill: ${tokens.muted} !important; font-family: ${tokens.font.heading.family}; font-weight: ${WEIGHT.heading}; }`,
    `.titleText, .pieTitleText, .radarTitle, .packetTitle, .treemapTitle { fill: ${tokens.fg} !important; font-family: ${tokens.font.heading.family}; font-weight: ${WEIGHT.title}; }`,
  ]
}

/** Sequence, gantt and journey text Mermaid colors on its own. */
function sequenceCSS(tokens: Tokens): string[] {
  return [
    `text.actor, text.actor > tspan { fill: ${tokens.accent.ink} !important; font-family: ${tokens.font.heading.family} !important; font-weight: ${WEIGHT.heading}; }`,
    `.messageText { fill: ${tokens.fg} !important; }`,
    `.labelText, .labelText > tspan { fill: ${tokens.fg} !important; }`,
    `.loopText, .loopText > tspan { fill: ${tokens.muted} !important; }`,
    `.loopLine { stroke: ${tokens.faint} !important; }`,
    `.actor-icon { fill: none; stroke: ${tokens.accent.ink}; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }`,
    `.noteText, .noteText > tspan { fill: ${tokens.semantic.caution.ink} !important; }`,
    `text.task, text.journey-section, .taskText, .taskTextOutsideRight, .taskTextOutsideLeft { fill: ${tokens.fg} !important; }`,
    `.sectionTitle, .sectionTitle tspan { fill: ${tokens.fg} !important; }`,
    `.grid .tick line, .grid path { stroke: ${tokens.border} !important; }`,
    `.grid .tick text { fill: ${tokens.muted} !important; }`,
  ]
}

/**
 * The rest: sankey links blend by multiplying (black on a dark canvas), venn and radar take the
 * deep category tints, architecture icons are a fixed Azure blue, C4 is fixed greys.
 */
function chartCSS(tokens: Tokens): string[] {
  const { accent, semantic } = tokens
  return [
    '.link { mix-blend-mode: normal !important; stroke-opacity: 0.38 !important; }',
    `.slice { font-weight: ${WEIGHT.body}; }`,
    `marker circle[fill="white"] { fill: ${tokens.bg} !important; stroke: ${tokens.muted}; }`,
    `g text[fill="#FFFFFF"] { fill: ${tokens.fg} !important; }`,
    `[stroke="#444444"], marker path[stroke="#000000"] { stroke: ${tokens.muted} !important; }`,
    `text[fill="#444444"], marker path[fill="black"] { fill: ${tokens.muted} !important; }`,
    `.venn-area text { font-family: ${tokens.font.family} !important; }`,
    `.venn-circle text { fill: ${tokens.fg} !important; font-family: ${tokens.font.heading.family}; font-weight: ${WEIGHT.heading}; }`,
    `.venn-intersection text { fill: ${tokens.muted} !important; }`,
    `.node-icon-text > div { color: ${tokens.fg} !important; }`,
    `svg rect[width="80"][height="80"] { fill: ${accent.soft} !important; }`,
    `.commit-label { fill: ${tokens.muted} !important; }`,
    `.tag-label { fill: ${tokens.fg} !important; }`,
    `.kanban-label, .kanban-label tspan { fill: ${tokens.fg} !important; }`,
    `.cluster[class*="section-"] > rect { fill: ${tokens.sunken} !important; stroke: ${tokens.border} !important; }`,
    `.items .node rect.label-container { fill: ${tokens.surface} !important; stroke: ${tokens.border} !important; }`,
    `.items line[stroke="red"] { stroke: ${semantic.negative.stroke} !important; }`,
    `.items line[stroke="orange"] { stroke: ${semantic.reinforcing.stroke} !important; }`,
    `.items line[stroke="blue"] { stroke: ${semantic.balancing.stroke} !important; }`,
    `.items line[stroke="lightblue"] { stroke: ${semantic.balancing.soft} !important; }`,
    `.treemapLabel { fill: ${tokens.fg} !important; }`,
    `.treemapValue { fill: ${tokens.muted} !important; }`,
    `.ishikawa .ishikawa-head { fill: ${semantic.negative.fill}; stroke: ${semantic.negative.stroke}; }`,
    `.ishikawa .ishikawa-head-label { fill: ${semantic.negative.ink}; }`,
    `.ishikawa .ishikawa-label-box { fill: ${tokens.surface}; stroke: ${tokens.border}; }`,
    '.usecase-element .label text { text-anchor: middle; }',
    `.usecase-actor-label text { font-family: ${tokens.font.heading.family} !important; font-weight: ${WEIGHT.heading}; }`,
    `.relationship-label, .usecase .edgeLabel { font-size: 12px !important; }`,
  ]
}

/** Journey draws its axis in black, its faces in cream and its outlines in fixed greys. */
function journeyCSS(tokens: Tokens): string[] {
  const { caution } = tokens.semantic
  const rules = [
    `line[stroke="black"] { stroke: ${tokens.faint} !important; stroke-width: 2px; }`,
    `marker[id$="-arrowhead"] path { fill: ${tokens.faint}; }`,
    `.face { fill: ${caution.fill} !important; stroke: ${caution.stroke} !important; }`,
    `.mouth { stroke: ${caution.strong} !important; fill: ${caution.strong}; }`,
    `.task-line { stroke: ${tokens.border} !important; }`,
    `circle[class^="actor-"] { stroke: ${tokens.bg} !important; stroke-width: 2px; }`,
    `.legend, .legend tspan { fill: ${tokens.muted} !important; }`,
    `text[font-family*="trebuchet"] { font-family: ${tokens.font.heading.family} !important; font-size: 20px; font-weight: ${WEIGHT.title}; fill: ${tokens.fg}; }`,
  ]
  for (let i = 0; i < 8; i++) {
    const sw = category({ tokens, index: i })
    rules.push(
      `.section-type-${i}, .task-type-${i} { stroke: ${sw.stroke} !important; }`,
      `rect.journey-section.section-type-${i} { fill: ${sw.soft} !important; }`,
      `circle.actor-${i} { fill: ${sw.stroke} !important; }`,
    )
  }
  return rules
}

/** d3's Tableau 10, which sankey colors its nodes from with no theme hook. */
const TABLEAU = ['4e79a7', 'f28e2c', 'e15759', '76b7b2', '59a14f']
const TABLEAU_MORE = ['edc949', 'af7aa1', 'ff9da7', '9c755f', 'bab0ab']

/** Sankey: each Tableau color, on nodes and link gradients, swapped for a palette color. */
function sankeyCSS(tokens: Tokens): string[] {
  return [...TABLEAU, ...TABLEAU_MORE].map((hex, i) => {
    const color = category({ tokens, index: i }).stroke
    return `.node rect[fill="#${hex}"] { fill: ${color} !important; } stop[stop-color="#${hex}"] { stop-color: ${color} !important; }`
  })
}

/** Per-category rules: mindmap and timeline branches, radar curves, venn sets. */
function categoryCSS(tokens: Tokens): string[] {
  const rules: string[] = []
  for (let i = 0; i < SCALE; i++) {
    const sw = category({ tokens, index: i })
    rules.push(
      `.section-edge-${i - 1} { stroke: ${sw.stroke} !important; }`,
      `.section-${i - 1} line { stroke: ${sw.stroke} !important; }`,
      `.radarCurve-${i}, .radarLegendBox-${i} { stroke: ${sw.stroke} !important; fill: ${sw.stroke} !important; }`,
      `.venn-set-${i} path { fill: ${sw.stroke} !important; fill-opacity: 0.14 !important; stroke: ${sw.stroke} !important; stroke-width: 2px; }`,
    )
  }
  return rules
}

/**
 * What theme variables can't reach: colors Mermaid writes inline, hard-codes, or derives itself.
 * Mermaid scopes these rules under the svg's own id, so they never leak between diagrams.
 */
export function themeCSS(tokens: Tokens): string {
  return [
    ...labelCSS(tokens),
    ...sequenceCSS(tokens),
    ...chartCSS(tokens),
    ...journeyCSS(tokens),
    ...sankeyCSS(tokens),
    ...categoryCSS(tokens),
    ...(tokens.look === 'boxy' ? ['rect { rx: 0; ry: 0; }'] : []),
  ].join('\n')
}

/**
 * For diagrams Mermaid ships without a stylesheet (wardley, which draws black dashed stage lines
 * and leaves its text in the browser's serif). `#ID` is replaced with the svg's id.
 */
export function fallbackCSS(tokens: Tokens): string {
  return [
    `#ID text { font-family: ${tokens.font.family}; }`,
    `#ID [stroke="#000"] { stroke: ${tokens.border}; opacity: 1; }`,
    `#ID .wardley-title { font-family: ${tokens.font.heading.family}; font-size: 18px; font-weight: ${WEIGHT.title}; fill: ${tokens.fg}; }`,
    `#ID .wardley-node-label { font-size: 13px; fill: ${tokens.fg}; }`,
    `#ID .wardley-node--anchor .wardley-node-label { font-family: ${tokens.font.heading.family}; font-weight: ${WEIGHT.heading}; }`,
    `#ID .wardley-stage-label { font-size: 12px; }`,
    `#ID .wardley-node circle { stroke-width: 1.5px; }`,
    `#ID [class*="note"] text, #ID text[font-weight="bold"] { font-weight: ${WEIGHT.heading}; }`,
  ].join('\n')
}

/** Per-diagram settings that make Mermaid's layout match our own renderers' spacing and type. */
function diagrams(tokens: Tokens): Record<string, unknown> {
  return {
    flowchart: {
      htmlLabels: false,
      curve: tokens.look === 'boxy' ? 'step' : 'basis',
      padding: 12,
      nodeSpacing: 44,
      rankSpacing: 52,
    },
    sequence: {
      mirrorActors: false,
      actorFontFamily: tokens.font.family,
      noteFontFamily: tokens.font.family,
      messageFontFamily: tokens.font.family,
      actorFontSize: MERMAID_FONT_SIZE,
      noteFontSize: 13,
      messageFontSize: MERMAID_FONT_SIZE,
      boxMargin: 20,
    },
    class: { htmlLabels: false },
    state: { htmlLabels: false },
    gantt: { fontSize: 13, sectionFontSize: 13, barHeight: 22, barGap: 6 },
    journey: {
      taskFontFamily: tokens.font.family,
      taskFontSize: MERMAID_FONT_SIZE,
      actorColours: tokens.palette.map((sw) => sw.stroke),
    },
    sankey: { showValues: true, prefix: ' ', linkColor: 'gradient', nodeAlignment: 'justify' },
    pie: { textPosition: 0.7 },
    xyChart: { titleFontSize: 18 },
    radar: { marginLeft: 120, marginRight: 120, marginTop: 60, curveTension: 0.08 },
    c4: c4(tokens),
  }
}

/** The full `mermaid.initialize` config for tokens. */
export function mermaidConfig(tokens: Tokens): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    look: 'classic',
    darkMode: tokens.dark,
    fontFamily: tokens.font.family,
    htmlLabels: false,
    themeVariables: themeVariables(tokens),
    themeCSS: themeCSS(tokens),
    ...diagrams(tokens),
  }
}
