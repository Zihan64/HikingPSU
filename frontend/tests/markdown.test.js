import test from 'node:test'
import assert from 'node:assert/strict'
import { parseBlocks, parseInline } from '../src/markdown.js'

const flat = tokens => tokens.map(t => t.children ? `<${t.t}>${flat(t.children)}</${t.t}>` : t.t === 'text' ? t.v : `<${t.t}>${t.v}</${t.t}>`).join('')

test('the reply from the chat screenshot renders without raw markers', () => {
  const reply = `Here are three easy options near campus.

- **Arboretum & Hartley Wood Loop** is the easiest start.
  - Difficulty 1 (Starter): 1.2 mi loop, 60 ft of climbing.
  - Time: about 31 min.

- **Walnut Springs Park & Thompson Woods** gives you a real wooded feel.
  - Difficulty 1 (Starter): 2.5 mi loop.`
  const blocks = parseBlocks(reply)
  assert.deepEqual(blocks.map(b => b.type), ['p', 'list'])
  const items = blocks[1].items
  assert.deepEqual(items.map(i => i.level), [0, 1, 1, 0, 1])
  assert.equal(flat(parseInline(items[0].text)), '<bold>Arboretum & Hartley Wood Loop</bold> is the easiest start.')
  assert.ok(items.every(i => !i.text.startsWith('-')))
})

test('ordered lists, headings and paragraphs', () => {
  const blocks = parseBlocks('## Plan\n1. Take the bus\n2. Walk 10 min\n\nHave fun.')
  assert.deepEqual(blocks, [
    { type: 'h', text: 'Plan' },
    { type: 'list', ordered: true, items: [{ level: 0, text: 'Take the bus' }, { level: 0, text: 'Walk 10 min' }] },
    { type: 'p', text: 'Have fun.' },
  ])
})

test('inline bold, italic, code and links; plain asterisks are left alone', () => {
  assert.equal(flat(parseInline('**Bold** and *soft* and `id-1`')), '<bold>Bold</bold> and <em>soft</em> and <code>id-1</code>')
  assert.equal(flat(parseInline('Map: **https://example.org/a.pdf**')), 'Map: <bold><link>https://example.org/a.pdf</link></bold>')
  assert.equal(flat(parseInline('2 * 3 = 6')), '2 * 3 = 6')
})

test('markup in a reply stays text', () => {
  assert.equal(flat(parseInline('<img src=x onerror=alert(1)>')), '<img src=x onerror=alert(1)>')
  assert.deepEqual(parseBlocks(''), [])
})
