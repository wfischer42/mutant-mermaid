/**
 * Mermaid styles its SVG with a stylesheet that leans on `!important`, `hsl()` colors and selectors
 * resvg doesn't fully follow. This resolves the cascade in the DOM and writes each element's winning
 * declarations into its own `style`, so resvg draws what a browser would.
 */

interface Declaration {
  value: string
  rank: number
}

export type Found = Map<Element, Map<string, Declaration>>

/** Ids, then classes, attributes and pseudo-classes, then element names, as one sortable number. */
export function specificity(selector: string): number {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length
  const classes = (selector.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length
  const bare = selector.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|::?[\w-]+(\([^)]*\))?/g, ' ')
  const types = (bare.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) ?? []).length
  return ids * 10_000 + classes * 100 + types
}

/** Importance first, then inline over sheet, then specificity and order. */
function rankOf({
  important,
  inline,
  weight,
}: {
  important: boolean
  inline: boolean
  weight: number
}): number {
  return (important ? 4e12 : 0) + (inline ? 2e12 : 0) + weight
}

function matching({ root, selector }: { root: Element; selector: string }): Element[] {
  try {
    const self = root.matches(selector) ? [root] : []
    return [...self, ...Array.from(root.querySelectorAll(selector))]
  } catch {
    return []
  }
}

function declare({
  found,
  el,
  style,
  rank,
}: {
  found: Found
  el: Element
  style: CSSStyleDeclaration
  rank: (important: boolean) => number
}): void {
  const own = found.get(el) ?? new Map<string, Declaration>()
  found.set(el, own)
  for (let i = 0; i < style.length; i++) {
    const name = style[i]
    const important = style.getPropertyPriority(name) === 'important'
    const next = { value: style.getPropertyValue(name), rank: rank(important) }
    if ((own.get(name)?.rank ?? -1) <= next.rank) own.set(name, next)
  }
}

function rulesOf(css: string): CSSStyleRule[] {
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(css)
  return Array.from(sheet.cssRules).filter((rule) => rule instanceof CSSStyleRule)
}

function applySheet({ root, found, css }: { root: Element; found: Found; css: string }): void {
  let order = 0
  for (const rule of rulesOf(css)) {
    for (const selector of rule.selectorText.split(',')) {
      const weight = specificity(selector) * 1e5 + order++
      const rank = (important: boolean) => rankOf({ important, inline: false, weight })
      for (const el of matching({ root, selector: selector.trim() }))
        declare({ found, el, style: rule.style, rank })
    }
  }
}

function applyInline({ root, found }: { root: Element; found: Found }): void {
  const rank = (important: boolean) => rankOf({ important, inline: true, weight: 0 })
  for (const el of [root, ...Array.from(root.querySelectorAll('[style]'))]) {
    const [rule] = rulesOf(`x{${el.getAttribute('style') ?? ''}}`)
    if (rule) declare({ found, el, style: rule.style, rank })
  }
}

/**
 * resvg ignores the CSS `transform` property (Mermaid turns gantt milestones into diamonds with it),
 * so it becomes part of the element's `transform` attribute, about its `transform-origin`.
 */
function moveTransform({ el, declarations }: { el: Element; declarations: Map<string, Declaration> }): void {
  const css = declarations.get('transform')?.value
  declarations.delete('transform')
  if (!css || css === 'none') return
  const origin = declarations.get('transform-origin')?.value ?? el.getAttribute('transform-origin') ?? '0 0'
  const [ox = 0, oy = 0] = origin.split(/\s+/).map((v) => Number.parseFloat(v) || 0)
  const steps = css.replace(/(-?[\d.]+)(deg|px)/g, '$1')
  const own = el.getAttribute('transform') ?? ''
  el.setAttribute('transform', `${own} translate(${ox} ${oy}) ${steps} translate(${-ox} ${-oy})`.trim())
}

/** Each element's winning declarations, from the svg's stylesheets and its inline styles. */
export function cascade(root: Element): Found {
  const found: Found = new Map()
  for (const tag of Array.from(root.querySelectorAll('style')))
    applySheet({ root, found, css: tag.textContent ?? '' })
  applyInline({ root, found })
  return found
}

/** The value a property takes on an element: its own declaration, else the nearest ancestor's. */
export function cascaded({ found, el, name }: { found: Found; el: Element; name: string }): string | null {
  for (let at: Element | null = el; at; at = at.parentElement) {
    const value = found.get(at)?.get(name)?.value ?? at.getAttribute(name)
    if (value) return value
  }
  return null
}

/** Moves every stylesheet rule that applies onto the elements' own `style` attributes. */
export function inlineStyles(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const root = doc.documentElement
  const found = cascade(root)
  for (const tag of Array.from(root.querySelectorAll('style'))) tag.remove()
  for (const [el, declarations] of found) {
    moveTransform({ el, declarations })
    const text = Array.from(declarations, ([name, { value }]) => `${name}:${value}`).join(';')
    el.setAttribute('style', text)
  }
  return new XMLSerializer().serializeToString(root)
}
