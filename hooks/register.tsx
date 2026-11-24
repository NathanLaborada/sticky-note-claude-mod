import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Item, Mode } from '../types'

const PANE = 'sticky-note'
const TITLE = 'Sticky Note'

// Bump the shape tag if Item's fields change: older saved lists are then read as empty.
const items = atom({ plugin: 'sticky-note', key: 'items' } as const, [], { shape: 'items-1' })
const mode = atom({ plugin: 'sticky-note', key: 'mode' } as const, 'light')
const editing = atom({ plugin: 'sticky-note', key: 'editing' } as const, '')

// Neumorphism needs a base colour plus a lighter and a darker shadow of it.
export const PALETTE = {
  light: { base: '#e0e5ec', hi: '#ffffff', lo: '#a3b1c6', text: '#3d4555', muted: '#8a94a6', accent: '#6c8cff' },
  dark: { base: '#2a2d33', hi: '#363a42', lo: '#1a1c20', text: '#d7dce4', muted: '#7d8594', accent: '#8aa4ff' },
} as const
type Palette = (typeof PALETTE)[Mode]

// --- SVG pieces --------------------------------------------------------------

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// ponytail: truncates by character count, not measured width; full text shows when editing.
export const fit = (s: string, px: number) => {
  const max = Math.max(4, Math.floor(px / 7.5))
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

const soft = (t: Palette, d = 4) =>
  `<filter id="soft" x="-20%" y="-50%" width="140%" height="200%">` +
  `<feDropShadow in="SourceGraphic" dx="-${d}" dy="-${d}" stdDeviation="${d}" flood-color="${t.hi}" result="hi"/>` +
  `<feDropShadow in="SourceGraphic" dx="${d}" dy="${d}" stdDeviation="${d}" flood-color="${t.lo}" result="lo"/>` +
  `<feMerge><feMergeNode in="hi"/><feMergeNode in="lo"/></feMerge></filter>`

const svg = (w: number, h: number, t: Palette, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ` +
  `font-family="system-ui, -apple-system, Segoe UI, sans-serif"><defs>${soft(t)}</defs>` +
  `<rect width="${w}" height="${h}" fill="${t.base}"/>${body}</svg>`

export const headerSvg = (w: number, t: Palette, done: number, total: number) =>
  svg(w, 76, t,
    `<rect x="10" y="10" width="${w - 20}" height="56" rx="16" fill="${t.base}" filter="url(#soft)"/>` +
    `<text x="28" y="36" font-size="16" font-weight="700" fill="${t.text}">${TITLE}</text>` +
    `<text x="28" y="54" font-size="12" fill="${t.muted}">${total === 0 ? 'Nothing to do yet' : `${done} of ${total} done`}</text>`)

export const pillSvg = (w: number, t: Palette, item: Item) => {
  const check = item.isDone
    ? `<circle cx="34" cy="30" r="9" fill="${t.accent}"/><path d="M29.5 30.5l3 3 6-6.5" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<circle cx="34" cy="30" r="8" fill="none" stroke="${t.muted}" stroke-width="1.6"/>`
  // Open items are raised; done items sit flat and pressed-in.
  const card = item.isDone
    ? `<rect x="10" y="8" width="${w - 20}" height="44" rx="14" fill="${t.base}" stroke="${t.lo}" stroke-opacity="0.6"/>`
    : `<rect x="10" y="8" width="${w - 20}" height="44" rx="14" fill="${t.base}" filter="url(#soft)"/>`
  const label = esc(fit(item.text, w - 80))
  return svg(w, 60, t,
    card + check +
    `<text x="54" y="35" font-size="14" fill="${item.isDone ? t.muted : t.text}"` +
    `${item.isDone ? ' text-decoration="line-through"' : ''}>${label}</text>`)
}

export const glanceSvg = (w: number, t: Palette, list: Item[]) => {
  const open = list.filter(i => !i.isDone).slice(0, 5)
  const rows = open.length === 0
    ? `<text x="26" y="64" font-size="12" fill="${t.muted}">All done ✓</text>`
    : open.map((i, n) => `<text x="26" y="${64 + n * 18}" font-size="12" fill="${t.text}">• ${esc(fit(i.text, w - 60))}</text>`).join('')
  const h = 84 + Math.max(1, open.length) * 18
  return svg(w, h, t,
    `<rect x="10" y="10" width="${w - 20}" height="${h - 20}" rx="16" fill="${t.base}" filter="url(#soft)"/>` +
    `<text x="26" y="38" font-size="14" font-weight="700" fill="${t.text}">${TITLE}</text>` + rows)
}

// --- saving ------------------------------------------------------------------

const saveItems = async ($: EngineInterface, fn: (list: Item[]) => Item[]) => {
  await update($, items, fn)
  await $.store.set('items', await read($, items))
}

const newId = () => Math.random().toString(36).slice(2, 10)

// --- the mod -----------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('items')
    if (Array.isArray(saved)) await update($, items, () => saved as Item[])
    const savedMode = await $.store.get('mode')
    if (savedMode === 'light' || savedMode === 'dark') await update($, mode, () => savedMode)

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
    const m = await read($, mode)
    const editId = await read($, editing)
    const t = PALETTE[m]
    const done = list.filter(i => i.isDone).length

    // ponytail: ~8px per cell matches the desktop font at 100%; the SVG is capped to the slot if it's over.
    const width = Math.min(560, Math.max(160, (e.props.bodyColumns - 2) * 8))
    // Card plus three buttons needs ~420px; below that the buttons go on their own line under the card.
    const isWide = width >= 420
    const cardWidth = isWide ? width - 150 : width

    if (e.props.placement === 'widget' && Svg) {
      return <Svg source={glanceSvg(240, t, list)} alt={`${TITLE}: ${list.length - done} open`} />
    }

    const toggleMode = async () => {
      const nextMode: Mode = m === 'light' ? 'dark' : 'light'
      await update($, mode, () => nextMode)
      await $.store.set('mode', nextMode)
    }

    // Button text follows the note's palette through a Text child, whatever the app's theme.
    const btn = (key: string, text: string, onPress: () => unknown) =>
      Svg
        ? <Button key={key} onPress={onPress}><Text color={t.text}>{text}</Text></Button>
        : <Button key={key} label={text} onPress={onPress} />

    const row = (item: Item) => {
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
                await saveItems($, l => (text ? l.map(i => (i.id === item.id ? { ...i, text } : i)) : l.filter(i => i.id !== item.id)))
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
            ? <Svg source={pillSvg(cardWidth, t, item)} alt={`${item.isDone ? 'Done' : 'To do'}: ${item.text}`} />
            : <Text strikethrough={item.isDone} dimColor={item.isDone}>{item.isDone ? '[x]' : '[ ]'} {item.text}</Text>}
          <Box flexDirection="row" gap={1}>
            {btn(`done-${item.id}`, item.isDone ? '↺' : '✓', () => saveItems($, l => l.map(i => (i.id === item.id ? { ...i, isDone: !i.isDone } : i))))}
            {btn(`pen-${item.id}`, '✎', () => update($, editing, () => item.id))}
            {btn(`del-${item.id}`, '✕', () => saveItems($, l => l.filter(i => i.id !== item.id)))}
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" backgroundColor={Svg ? t.base : undefined} padding={1} gap={1}>
        {Svg
          ? <Svg source={headerSvg(width, t, done, list.length)} alt={`${TITLE}: ${done} of ${list.length} done`} />
          : <Text bold>{TITLE} · {done}/{list.length} done</Text>}
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
          {btn('mode', m === 'light' ? '☾ Dark' : '☀ Light', toggleMode)}
          {done > 0 && btn('clear', 'Clear done', () => saveItems($, l => l.filter(i => !i.isDone)))}
        </Box>
      </Box>
    )
  })
}
