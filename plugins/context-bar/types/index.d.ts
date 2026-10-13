export type Segment = { name: string; tokens: number; color: string; kind: string }
export type Snapshot = { segments: Segment[]; window: number }

/** One rate-limit window as the last API response reported it. */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/** Which parts of the band are shown. */
export type Show = { context: boolean; session: boolean; weekly: boolean }

declare module 'claude-code' {
  interface PluginState {
    'context-bar': {
      isOn: boolean
      snapshot: Snapshot | null
      limits: Limit[]
      show: Show
      // Screen pixels per CSS pixel in the desktop app (its zoom × display scale).
      scale: number
    }
  }
}
