import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Item, Mode, Scope } from '../types'

const PANE = 'sticky-note'
const TITLE = 'Sticky Note'

// Bump the shape tag if Item's fields change: older saved lists are then read as empty.
const items = atom({ plugin: 'sticky-note', key: 'items' } as const, [], { shape: 'items-1' })
// The list as it was before the last delete or "Clear done"; empty when there is nothing to undo.
const undo = atom({ plugin: 'sticky-note', key: 'undo' } as const, [], { shape: 'items-1' })
const mode = atom({ plugin: 'sticky-note', key: 'mode' } as const, 'auto')
const scope = atom({ plugin: 'sticky-note', key: 'scope' } as const, 'all')
const editing = atom({ plugin: 'sticky-note', key: 'editing' } as const, '')

// Neumorphism needs a base colour plus a lighter and a darker shadow of it.
export const PALETTE = {
  light: { base: '#e0e5ec', hi: '#ffffff', lo: '#a3b1c6', text: '#3d4555', muted: '#8a94a6', accent: '#6c8cff' },
  dark: { base: '#2a2d33', hi: '#363a42', lo: '#1a1c20', text: '#d7dce4', muted: '#7d8594', accent: '#8aa4ff' },
} as const
type Palette = (typeof PALETTE)['light' | 'dark']

const MODES: Mode[] = ['auto', 'light', 'dark']
const MODE_LABEL: Record<Mode, string> = { auto: '◐ Auto', light: '☀ Light', dark: '☾ Dark' }

// --- SVG pieces --------------------------------------------------------------

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// ponytail: truncates by character count, not measured width; full text shows when editing.
export const fit = (s: string, px: number) => {
  const max = Math.max(4, Math.floor(px / 7.5))
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

// Colours go through CSS classes so "auto" can switch them with the system's light/dark setting.
const rules = (p: Palette) =>
  `.b{fill:${p.base}}.t{fill:${p.text}}.m{fill:${p.muted}}.a{fill:${p.accent}}` +
  `.ms{stroke:${p.muted}}.ls{stroke:${p.lo}}.fh{flood-color:${p.hi}}.fl{flood-color:${p.lo}}`

export const style = (m: Mode) =>
  `<style>${m === 'auto'
    ? `${rules(PALETTE.light)}@media (prefers-color-scheme: dark){${rules(PALETTE.dark)}}`
    : rules(PALETTE[m])}</style>`

const soft = (d = 4) =>
  `<filter id="soft" x="-20%" y="-50%" width="140%" height="200%">` +
  `<feDropShadow class="fh" in="SourceGraphic" dx="-${d}" dy="-${d}" stdDeviation="${d}" result="hi"/>` +
  `<feDropShadow class="fl" in="SourceGraphic" dx="${d}" dy="${d}" stdDeviation="${d}" result="lo"/>` +
  `<feMerge><feMergeNode in="hi"/><feMergeNode in="lo"/></feMerge></filter>`

const svg = (w: number, h: number, m: Mode, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ` +
  `font-family="system-ui, -apple-system, Segoe UI, sans-serif">${style(m)}<defs>${soft()}</defs>` +
  `<rect class="b" width="${w}" height="${h}"/>${body}</svg>`

export const headerSvg = (w: number, m: Mode, done: number, total: number, where = '') =>
  svg(w, 76, m,
    `<rect class="b" x="10" y="10" width="${w - 20}" height="56" rx="16" filter="url(#soft)"/>` +
    `<text class="t" x="28" y="36" font-size="16" font-weight="700">${TITLE}</text>` +
    `<text class="m" x="28" y="54" font-size="12">${esc(fit(
      (total === 0 ? 'Nothing to do yet' : `${done} of ${total} done`) + (where ? ` · ${where}` : ''), w - 60))}</text>`)

export const pillSvg = (w: number, m: Mode, item: Item) => {
  const check = item.isDone
    ? `<circle class="a" cx="34" cy="30" r="9"/><path d="M29.5 30.5l3 3 6-6.5" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<circle class="ms" cx="34" cy="30" r="8" fill="none" stroke-width="1.6"/>`
  // Open items are raised; done items sit flat and pressed-in.
  const card = item.isDone
    ? `<rect class="b ls" x="10" y="8" width="${w - 20}" height="44" rx="14" stroke-opacity="0.6"/>`
    : `<rect class="b" x="10" y="8" width="${w - 20}" height="44" rx="14" filter="url(#soft)"/>`
  const label = esc(fit(item.text, w - 80))
  return svg(w, 60, m,
    card + check +
    `<text class="${item.isDone ? 'm' : 't'}" x="54" y="35" font-size="14"` +
    `${item.isDone ? ' text-decoration="line-through"' : ''}>${label}</text>`)
}

export const glanceSvg = (w: number, m: Mode, list: Item[]) => {
  const open = list.filter(i => !i.isDone).slice(0, 5)
  const rows = open.length === 0
    ? `<text class="m" x="26" y="64" font-size="12">All done ✓</text>`
    : open.map((i, n) => `<text class="t" x="26" y="${64 + n * 18}" font-size="12">• ${esc(fit(i.text, w - 60))}</text>`).join('')
  const h = 84 + Math.max(1, open.length) * 18
  return svg(w, h, m,
    `<rect class="b" x="10" y="10" width="${w - 20}" height="${h - 20}" rx="16" filter="url(#soft)"/>` +
    `<text class="t" x="26" y="38" font-size="14" font-weight="700">${TITLE}</text>` + rows)
}

// --- the list and where it is saved ------------------------------------------

// "all" keeps one list for every folder; "project" keeps one per working folder.
const listKey = async ($: EngineInterface) =>
  (await read($, scope)) === 'project' ? `items:${await $.session.cwd()}` : 'items'

const loadList = async ($: EngineInterface) => {
  const saved = await $.store.get(await listKey($))
  await update($, items, () => (Array.isArray(saved) ? (saved as Item[]) : []))
  await update($, undo, () => [])
}

// `canUndo` keeps the list as it was so "Undo" can bring it back; any other change forgets it.
const saveItems = async ($: EngineInterface, fn: (list: Item[]) => Item[], canUndo = false) => {
  const before = await read($, items)
  await update($, items, fn)
  await update($, undo, () => (canUndo ? before : []))
  await $.store.set(await listKey($), await read($, items))
}

export const move = (list: Item[], id: string, by: -1 | 1) => {
  const from = list.findIndex(i => i.id === id)
  const to = from + by
  if (from < 0 || to < 0 || to >= list.length) return list
  const next = [...list]
  ;[next[from], next[to]] = [next[to]!, next[from]!]
  return next
}

const newId = () => Math.random().toString(36).slice(2, 10)

const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path

// --- the mod -----------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const savedMode = await $.store.get('mode')
    if (MODES.includes(savedMode as Mode)) await update($, mode, () => savedMode as Mode)
    const savedScope = await $.store.get('scope')
    if (savedScope === 'all' || savedScope === 'project') await update($, scope, () => savedScope)
    await loadList($)

    await $.command.register({ name: 'sticky-note', description: 'Open the sticky note pane' })
    void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })

  on('command.run', { command: 'sticky-note' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Sticky note opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button, Input } = table
    const Svg = 'Svg' in table ? table.Svg : undefined
    const list = await read($, items)
    const undoList = await read($, undo)
    const m = await read($, mode)
    const sc = await read($, scope)
    const editId = await read($, editing)
    const where = sc === 'project' ? folderName(await $.session.cwd()) : ''
    const done = list.filter(i => i.isDone).length
    // In auto mode the pane's background and button text are left to the app's theme.
    const textColor = m === 'auto' ? undefined : PALETTE[m].text

    // ponytail: ~8px per cell matches the desktop font at 100%; the SVG is capped to the slot if it's over.
    const width = Math.min(560, Math.max(160, (e.props.bodyColumns - 2) * 8))
    // Card plus five buttons needs ~480px; below that the buttons go on their own line under the card.
    const isWide = width >= 480
    const cardWidth = isWide ? width - 230 : width

    if (e.props.placement === 'widget' && Svg) {
      return <Svg source={glanceSvg(240, m, list)} alt={`${TITLE}: ${list.length - done} open`} />
    }

    const cycleMode = async () => {
      const nextMode = MODES[(MODES.indexOf(m) + 1) % MODES.length]!
      await update($, mode, () => nextMode)
      await $.store.set('mode', nextMode)
    }

    const toggleScope = async () => {
      const nextScope: Scope = sc === 'all' ? 'project' : 'all'
      await update($, scope, () => nextScope)
      await update($, editing, () => '')
      await $.store.set('scope', nextScope)
      await loadList($)
    }

    // Button text follows the note's palette through a Text child; in auto, the app's.
    const btn = (key: string, text: string, onPress: () => unknown) =>
      Svg
        ? <Button key={key} onPress={onPress}><Text color={textColor}>{text}</Text></Button>
        : <Button key={key} label={text} onPress={onPress} />

    const row = (item: Item, n: number) => {
      if (item.id === editId) {
        return (
          <Box flexDirection="row" gap={1} alignItems="center">
            <Input
              key={`edit-${item.id}`}
              value={item.text}
              autoFocus
              submitLabel="Save"
              onSubmit={async value => {
                const text = value.trim()
                await saveItems($, l => (text ? l.map(i => (i.id === item.id ? { ...i, text } : i)) : l.filter(i => i.id !== item.id)), !text)
                await update($, editing, () => '')
              }}
            />
            {btn(`cancel-${item.id}`, 'Cancel', () => update($, editing, () => ''))}
          </Box>
        )
      }
      return (
        <Box flexDirection={isWide ? 'row' : 'column'} flexWrap="wrap" gap={isWide ? 1 : 0} alignItems={isWide ? 'center' : 'flex-end'}>
          {Svg
            ? <Svg source={pillSvg(cardWidth, m, item)} alt={`${item.isDone ? 'Done' : 'To do'}: ${item.text}`} />
            : <Text strikethrough={item.isDone} dimColor={item.isDone}>{item.isDone ? '[x]' : '[ ]'} {item.text}</Text>}
          <Box flexDirection="row" gap={1}>
            {n > 0 && btn(`up-${item.id}`, '↑', () => saveItems($, l => move(l, item.id, -1)))}
            {n < list.length - 1 && btn(`down-${item.id}`, '↓', () => saveItems($, l => move(l, item.id, 1)))}
            {btn(`done-${item.id}`, item.isDone ? '↺' : '✓', () => saveItems($, l => l.map(i => (i.id === item.id ? { ...i, isDone: !i.isDone } : i))))}
            {btn(`pen-${item.id}`, '✎', () => update($, editing, () => item.id))}
            {btn(`del-${item.id}`, '✕', () => saveItems($, l => l.filter(i => i.id !== item.id), true))}
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" backgroundColor={Svg && m !== 'auto' ? PALETTE[m].base : undefined} padding={1} gap={1}>
        {Svg
          ? <Svg source={headerSvg(width, m, done, list.length, where)} alt={`${TITLE}: ${done} of ${list.length} done`} />
          : <Text bold>{TITLE} · {done}/{list.length} done{where ? ` · ${where}` : ''}</Text>}
        {list.map(row)}
        <Input
          // A new key after each add remounts the field, which empties it.
          key={`new-${list.length}`}
          placeholder="Add a to-do…"
          submitLabel="Add"
          onSubmit={async value => {
            const text = value.trim()
            if (text) await saveItems($, l => [...l, { id: newId(), text, isDone: false }])
          }}
        />
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {undoList.length > 0 && btn('undo', '↶ Undo', async () => {
            await update($, items, () => undoList)
            await update($, undo, () => [])
            await $.store.set(await listKey($), undoList)
          })}
          {done > 0 && btn('clear', 'Clear done', () => saveItems($, l => l.filter(i => !i.isDone), true))}
          {btn('mode', MODE_LABEL[m], cycleMode)}
          {btn('scope', sc === 'project' ? '📁 This folder' : '🌐 All folders', toggleScope)}
        </Box>
      </Box>
    )
  })
}
