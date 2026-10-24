// A tiny, safe Markdown subset for chat replies: paragraphs, "-"/"*"/"1." lists (one nested
// level), "#" headings, **bold**, *italic*, `code` and https links. No HTML is ever parsed:
// everything becomes plain React text, so a reply can't inject markup.

const ITEM = /^(\s*)(?:[-*•]|(\d+)[.)])\s+(.*)$/
const HEADING = /^\s*#{1,6}\s+(.*)$/
const LINK = /(https:\/\/[^\s<>"。]+)/g
const INLINE = /\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|(?<![\w*])\*(?!\s)([^*\n]+?)\*(?![\w*])/g

/** Split a reply into blocks: {type:'p', text} | {type:'h', text} | {type:'list', ordered, items:[{level, text}]} */
export function parseBlocks(text) {
  const blocks = []
  let para = []
  const flush = () => {
    if (para.length) blocks.push({ type: 'p', text: para.join('\n') })
    para = []
  }
  for (const line of String(text ?? '').replace(/\r/g, '').split('\n')) {
    if (!line.trim()) { flush(); continue }
    const heading = HEADING.exec(line)
    if (heading) { flush(); blocks.push({ type: 'h', text: heading[1] }); continue }
    const item = ITEM.exec(line)
    if (item) {
      flush()
      const level = item[1].replace(/\t/g, '  ').length >= 2 ? 1 : 0
      const ordered = level === 0 && item[2] !== undefined
      const last = blocks.at(-1)
      // Blank lines between items don't end a list; a paragraph does.
      if (last?.type === 'list' && (level === 1 || last.ordered === ordered)) last.items.push({ level, text: item[3] })
      else blocks.push({ type: 'list', ordered, items: [{ level, text: item[3] }] })
      continue
    }
    para.push(line.trim())
  }
  flush()
  return blocks
}

function links(text) {
  return text.split(LINK).filter(Boolean).map(part => part.startsWith('https://') ? { t: 'link', v: part } : { t: 'text', v: part })
}

/** Inline tokens: {t:'text'|'link'|'code', v} | {t:'bold'|'em', children:[...]} */
export function parseInline(text) {
  const out = []
  let at = 0
  for (const m of String(text).matchAll(INLINE)) {
    if (m.index > at) out.push(...links(text.slice(at, m.index)))
    if (m[1] ?? m[2]) out.push({ t: 'bold', children: links(m[1] ?? m[2]) })
    else if (m[3]) out.push({ t: 'code', v: m[3] })
    else out.push({ t: 'em', children: links(m[4]) })
    at = m.index + m[0].length
  }
  if (at < text.length) out.push(...links(text.slice(at)))
  return out
}
