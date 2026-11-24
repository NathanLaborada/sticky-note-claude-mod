export type Item = { id: string; text: string; isDone: boolean }
export type Mode = 'light' | 'dark'

declare module 'claude-code' {
  interface PluginState {
    'sticky-note': {
      items: Shaped<Item[]>
      mode: Mode
      editing: string
    }
  }
}
