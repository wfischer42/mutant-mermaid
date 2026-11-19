import { bind, highlight, type PartEvent } from '../src/index.ts'

/**
 * The gallery as a host app: hovering any tagged part shows a card naming it, and clicking one
 * pins the card with what an app's handler would be handed. Actions are shown, not run, so an
 * `href` doesn't navigate away. One binding on `main` covers every re-render.
 */
export function wireHooks(main: HTMLElement): void {
  const card = document.createElement('div')
  card.className = 'hook-card'
  card.hidden = true
  document.body.append(card)
  let pinned: string | null = null

  const show = ({ part, clicked }: { part: PartEvent; clicked: boolean }) => {
    const args = part.args.map((a) => JSON.stringify(a)).join(', ')
    const call = part.action ? `${part.action}(${args})` : ''
    card.innerHTML =
      `<div class="head"><span class="kind">${escape(part.kind)}</span><code>${escape(part.id)}</code></div>` +
      (call
        ? `<div class="call">${clicked ? 'ran' : 'click runs'} <code>${escape(call)}</code></div>`
        : '') +
      (clicked && !call ? '<div class="call">no click line for this part</div>' : '')
    card.classList.toggle('clicked', clicked)
    card.style.setProperty('--tint', part.tint ?? '')
    card.hidden = false
    const { rect } = part
    card.style.left = `${Math.min(rect.right + 10, window.innerWidth - card.offsetWidth - 12)}px`
    card.style.top = `${Math.max(12, Math.min(rect.top, window.innerHeight - card.offsetHeight - 12))}px`
  }

  bind(main, {
    actions: { href: () => {} },
    onEnter: (part) => {
      if (!pinned) show({ part, clicked: false })
    },
    onLeave: () => {
      if (!pinned) card.hidden = true
    },
    onClick: (part) => {
      const root = part.element.closest<HTMLElement>('.figure') ?? main
      pinned = pinned === part.id ? null : part.id
      highlight({ root, ids: pinned ? [part.id] : [] })
      if (pinned) show({ part, clicked: true })
      else card.hidden = true
    },
  })
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
