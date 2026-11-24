export type Item = { id: string; text: string; isDone: boolean }
export type Mode = 'auto' | 'light' | 'dark'
export type Scope = 'all' | 'project'

declare module 'claude-code' {
  interface PluginState {
    'sticky-note': {
      items: Shaped<Item[]>
      undo: Shaped<Item[]>
      mode: Mode
      scope: Scope
      editing: string
    }
  }
}
