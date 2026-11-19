import type { Adaptive } from './adaptive.ts'

/** Encodes an svg for a data URL in single quotes, keeping it readable where that's safe. */
const encode = (svg: string) =>
  svg.replace(/[%"'#<>{}\n]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)

/** Drops what an image doesn't need: hook attributes, hover tints and filters nothing uses. */
function trim(svg: string): string {
  return svg
    .replace(/ data-mm-[\w-]+="[^"]*"/g, '')
    .replace(/ style="--mm-tint:[^";]*"/g, '')
    .replace(/<filter id="([^"]+)"[\s\S]*?<\/filter>/g, (filter, id) =>
      svg.includes(`url(#${id})`) ? filter : '',
    )
    .replace('<defs></defs>', '')
}

/**
 * Swaps the palette sheet for the chat's own setting: `data-mode` on the page's root when it has
 * one, else the system's. An image can only see the system's, so this rebuilds its source, and
 * again whenever either changes. The img's id is the drawing's scope class.
 */
const follow = ({ palettes, scope }: Adaptive) => `<script>(() => {
  const img = document.getElementById('${scope}')
  const svg = decodeURIComponent(img.getAttribute('src').slice('data:image/svg+xml,'.length))
  const palettes = ${JSON.stringify(palettes)}
  const query = matchMedia('(prefers-color-scheme: dark)')
  const show = () => {
    const mode = document.documentElement.dataset.mode || (query.matches ? 'dark' : 'light')
    const css = Object.entries(palettes[mode] || palettes.light).map(([k, v]) => k + ':' + v).join(';')
    const sheet = '<style class="mm-palette">svg.${scope}{' + css + '}</style>'
    img.src = 'data:image/svg+xml,' + encodeURIComponent(svg.replace(/<style class="mm-palette">[^<]*<\\/style>/, sheet))
  }
  show()
  new MutationObserver(show).observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] })
  query.addEventListener('change', show)
})()</script>`

/**
 * An `<img>` tag holding the drawing as a data URL, for chats that show HTML but redraw raw SVG
 * badly. Given an adaptive drawing it follows the chat's light or dark setting with a small script;
 * without the script it still follows the system's.
 */
export function inlineImg(drawing: string | Adaptive): string {
  const svg = trim(typeof drawing === 'string' ? drawing : drawing.svg)
  const title = /<title>([^<]*)<\/title>/.exec(svg)?.[1] ?? 'Diagram'
  const width = /viewBox="[\d.-]+ [\d.-]+ ([\d.]+)/.exec(svg)?.[1]
  const style = `width:100%;${width ? `max-width:${width}px;` : ''}height:auto;display:block;border-radius:12px`
  const img = (id: string) =>
    `<img${id} alt="${title.replace(/"/g, '&quot;')}" style="${style}" src='data:image/svg+xml,${encode(svg)}'>`
  if (typeof drawing === 'string') return img('')
  return img(` id="${drawing.scope}"`) + follow(drawing)
}
