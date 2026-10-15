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
      // Category names you moved into Other.
      hidden: string[]
      // Whether the row listing what is in Other is open.
      otherOpen: boolean
      // The system theme the colours follow.
      theme: 'dark' | 'light'
      // Context tokens in use after the last reply, and what that reply added.
      lastUsed: number | null
      lastDelta: number | null
      // The session's cost so far, in US dollars, when known.
      cost: number | null
      // Which alerts have been shown, so each shows once per crossing.
      alerted: Record<string, boolean>
      // Screen pixels per CSS pixel in the desktop app (its zoom × display scale).
      scale: number
    }
  }
}
