import { expect, test } from 'claude-code/testing'

import type { On } from 'claude-code'

import { PALETTE, esc, fit, move, pillSvg, style } from './register'

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
    data,
    items: (key = 'items') => (data[key] ?? []) as Item[],
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
    // Undo brings the deleted item back, then goes away.
    await ui.press({ key: 'undo' })
    expect(store.items().map(i => i.text)).toEqual(['Buy milk'])
    expect(await ui.find({ key: 'undo' })).toBeFalsy()
    await ui.press({ key: `del-${first.id}` })
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

test('items move up and down', async ($, on) => {
  const store = memoryStore(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  for (const [n, text] of ['a', 'b', 'c'].entries()) await ui.input({ key: `new-${n}`, text })
  const [a, b] = store.items()
  await ui.press({ key: `up-${b!.id}` })
  expect(store.items().map(i => i.text)).toEqual(['b', 'a', 'c'])
  await ui.press({ key: `down-${a!.id}` })
  expect(store.items().map(i => i.text)).toEqual(['b', 'c', 'a'])
  // The top item has no up button.
  expect(await ui.find({ key: `up-${b!.id}` })).toBeFalsy()
  expect(move(store.items(), 'missing', 1)).toEqual(store.items())
  await ui.unmount()
})

test('"This folder" keeps a separate list from "All folders"', async ($, on) => {
  const store = memoryStore(on)
  on('session.cwd', () => ({ value: '/work/project-a' }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.input({ key: 'new-0', text: 'shared' })
  await ui.press({ key: 'scope' })
  expect(store.data.scope).toBe('project')
  expect(await ui.find({ key: 'new-0' })).toBeTruthy()
  await ui.input({ key: 'new-0', text: 'only here' })
  expect(store.items('items:/work/project-a').map(i => i.text)).toEqual(['only here'])
  expect(store.items().map(i => i.text)).toEqual(['shared'])
  await ui.press({ key: 'scope' })
  expect(await ui.find({ key: 'new-1' })).toBeTruthy()
  await ui.unmount()
})

test('the theme cycles auto, light, dark and is remembered', async ($, on) => {
  const store = memoryStore(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'mode' })
  expect(store.mode()).toBe('light')
  await ui.press({ key: 'mode' })
  expect(store.mode()).toBe('dark')
  await ui.press({ key: 'mode' })
  expect(store.mode()).toBe('auto')
  await ui.unmount()
})

test('in light mode, button text is drawn in the dark text colour; in auto, the app picks', async ($, on) => {
  memoryStore(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Auto/ }))?.props?.color).toBe(undefined)
  await ui.press({ key: 'mode' })
  const label = await ui.find({ type: 'Text', text: /Light/ })
  expect(label?.props?.color).toBe(PALETTE.light.text)
  await ui.unmount()
})

test('note text cannot break out of the SVG', () => {
  expect(esc(`<script>"&'`)).toBe('&lt;script&gt;&quot;&amp;&#39;')
  const out = pillSvg(300, 'dark', { id: 'a', text: '</svg><b>', isDone: false })
  expect(out.includes('</svg><b>')).toBe(false)
  expect(fit('abcdefghijklmnopqrstuvwxyz', 60).endsWith('…')).toBe(true)
})

test('auto mode carries both palettes, switched by the system setting', () => {
  const css = style('auto')
  expect(css.includes(PALETTE.light.base) && css.includes(PALETTE.dark.base)).toBe(true)
  expect(css.includes('prefers-color-scheme: dark')).toBe(true)
  expect(style('dark').includes(PALETTE.light.base)).toBe(false)
})
