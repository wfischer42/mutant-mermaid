/**
 * Wires a rendered diagram to a host app in the browser: one set of listeners on the element
 * holding the SVG reports the tagged part under the pointer, and runs the action a `click` line
 * named for it. Nothing here runs at render time, so Node never touches it.
 */

/** A tagged part of a diagram the pointer is on or has clicked. */
export interface PartEvent {
  /** The part's id: a node's own id, `e1` or `A->B` for an edge, a slug of the label elsewhere. */
  id: string
  /** What sort of part it is, such as `node`, `edge`, `cluster` or `event`. */
  kind: string
  /** The part's own color in the theme, for a card or highlight that matches it. */
  tint?: string
  /** The action a `click` line named for this part, if any. */
  action?: string
  args: string[]
  element: SVGGElement
  /** Where the part sits in the viewport, for placing a card beside it. */
  rect: DOMRect
  event: Event
}

export type PartHandler = (part: PartEvent) => void

export interface BindOptions {
  /** Runs by action name when a part with a `click` line is clicked. */
  actions?: Record<string, PartHandler>
  /** Runs on a click on any tagged part, after its action. */
  onClick?: PartHandler
  /** Runs when the pointer moves onto a tagged part. */
  onEnter?: PartHandler
  /** Runs when the pointer leaves the part it was on. */
  onLeave?: PartHandler
}

const PART = '[data-mm-id]'

function partOf({ el, root }: { el: EventTarget | null; root: Element }): SVGGElement | null {
  if (!(el instanceof Element)) return null
  const part = el.closest<SVGGElement>(PART)
  return part && root.contains(part) ? part : null
}

/** `data-mm-args`, a JSON array of strings written by applyHooks. */
function argsOf(json: string | undefined): string[] {
  const parsed: unknown = json ? JSON.parse(json) : []
  return Array.isArray(parsed) ? parsed.map(String) : []
}

function describe({ element, event }: { element: SVGGElement; event: Event }): PartEvent {
  const { mmId = '', mmKind = '', mmAction, mmArgs } = element.dataset
  return {
    id: mmId,
    kind: mmKind,
    tint: element.style.getPropertyValue('--mm-tint') || undefined,
    action: mmAction,
    args: argsOf(mmArgs),
    element,
    rect: element.getBoundingClientRect(),
    event,
  }
}

/** What `click A href "/docs" _blank` does when the app gives no `href` action of its own. */
function follow(part: PartEvent): void {
  const [url, target = '_self'] = part.args
  if (url) window.open(url, target)
}

function handlerFor({
  part,
  actions,
}: {
  part: PartEvent
  actions: Record<string, PartHandler>
}): PartHandler | null {
  if (!part.action) return null
  return actions[part.action] ?? (part.action === 'href' ? follow : null)
}

/**
 * Listens on `root`, the element holding a rendered diagram, for clicks and hovers on its tagged
 * parts. Works across re-renders into the same root. Returns a function that stops listening.
 */
export function bind(root: HTMLElement, options: BindOptions = {}): () => void {
  const { actions = {}, onClick, onEnter, onLeave } = options
  let current: SVGGElement | null = null

  const click = (event: MouseEvent) => {
    const element = partOf({ el: event.target, root })
    if (!element) return
    const part = describe({ element, event })
    handlerFor({ part, actions })?.(part)
    onClick?.(part)
  }

  const over = (event: PointerEvent) => {
    const element = partOf({ el: event.target, root })
    if (element === current) return
    if (current) onLeave?.(describe({ element: current, event }))
    current = element
    if (element) onEnter?.(describe({ element, event }))
  }

  const out = (event: PointerEvent) => {
    const to = event.relatedTarget
    if (!current || (to instanceof Node && root.contains(to))) return
    onLeave?.(describe({ element: current, event }))
    current = null
  }

  root.addEventListener('click', click)
  root.addEventListener('pointerover', over)
  root.addEventListener('pointerout', out)
  return () => {
    root.removeEventListener('click', click)
    root.removeEventListener('pointerover', over)
    root.removeEventListener('pointerout', out)
  }
}

/**
 * Marks the parts with these ids as `data-mm-active` and clears the rest, so the app can show
 * its own selection. Style it with CSS such as `[data-mm-active] path { stroke-width: 3 }`.
 */
export function highlight({ root, ids }: { root: Element; ids: string[] }): void {
  const want = new Set(ids)
  for (const el of root.querySelectorAll<SVGGElement>(PART)) {
    el.toggleAttribute('data-mm-active', want.has(el.dataset.mmId ?? ''))
  }
}
