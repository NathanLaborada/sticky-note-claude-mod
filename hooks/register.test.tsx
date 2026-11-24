import { expect, test } from 'claude-code/testing'

import type { On } from 'claude-code'

import { PALETTE, esc, fit, pillSvg } from './register'

type Item = { id: string; text: string; isDone: boolean }

// An in-memory store standing in for the engine's, so the test can see what the mod saved.
const memoryStore = (on: On) => {
  const data: Record<string, unknown> = {}
  on('store.get', (_, e) => ({ value: data[e.key] }))
  on('store.set', (_, e) => {
    data[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  return {
    items: () => (data.items ?? []) as Item[],
    mode: () => data.mode,
  }
}

const PANE = {
  plugin: 'sticky-note',
  component: 'Pane',
  requestId: 'sticky-note',
  props: {
    title: 'Sticky Note',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('add, check off and delete a to-do, on every surface that takes input', async ($, on) => {
  const store = memoryStore(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.input({ key: 'new-0', text: 'Buy milk' })
    // The add box is a fresh, empty field after adding.
    expect(await ui.find({ key: 'new-1' })).toBeTruthy()

    const first = store.items()[0]
    if (!first) throw new Error('nothing was saved')
    expect(store.items().length).toBe(1)
    expect(first.text).toBe('Buy milk')

    await ui.press({ key: `done-${first.id}` })
    expect(store.items()[0]?.isDone).toBe(true)

    await ui.press({ key: `del-${first.id}` })
    expect((store.items()).length).toBe(0)
    await ui.unmount()
  }
})

test('blank input adds nothing', async ($, on) => {
  const store = memoryStore(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.input({ key: 'new-0', text: '   ' })
  expect(store.items()).toEqual([])
  await ui.unmount()
})

test('the mode toggle is remembered', async ($, on) => {
  const store = memoryStore(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'mode' })
  expect(store.mode()).toBe('dark')
  await ui.press({ key: 'mode' })
  expect(store.mode()).toBe('light')
  await ui.unmount()
})

test('note text cannot break out of the SVG', () => {
  expect(esc(`<script>"&'`)).toBe('&lt;script&gt;&quot;&amp;&#39;')
  const out = pillSvg(300, PALETTE.dark,
    { id: 'a', text: '</svg><b>', isDone: false })
  expect(out.includes('</svg><b>')).toBe(false)
  expect(fit('abcdefghijklmnopqrstuvwxyz', 60).endsWith('…')).toBe(true)
})

test('in light mode, button text is drawn in the dark text colour', async ($, on) => {
  memoryStore(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const label = await ui.find({ type: 'Text', text: /Dark/ })
  expect(label?.props?.color).toBe(PALETTE.light.text)
  await ui.unmount()
})
