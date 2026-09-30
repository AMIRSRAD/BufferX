import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEYS } from '@/store/persist'
import { TOOLS_PERSISTED_KEYS, useTools } from '@/store/tools'

const INITIAL = useTools.getState()

const tools = () => useTools.getState()

beforeEach(() => {
  localStorage.clear()
  useTools.setState(INITIAL, true)
})

describe('tools: dock behaviour (UX_SPEC 1.2)', () => {
  it('opening a tool never closes another', () => {
    tools().openTool('mac')
    tools().openTool('pin')
    tools().openTool('tlv')

    expect(tools().open).toEqual(['mac', 'pin', 'tlv'])
    expect(tools().focused).toBe('tlv')
  })

  it('re-opening an open tool focuses it instead of duplicating it', () => {
    tools().openTool('mac')
    tools().openTool('pin')
    tools().openTool('mac')

    expect(tools().open).toEqual(['mac', 'pin'])
    expect(tools().focused).toBe('mac')
  })

  it('rail reactivation preserves the open workspace', () => {
    tools().toggleTool('mac')
    expect(tools().open).toEqual(['mac'])
    expect(tools().focused).toBe('mac')

    // Repeated navigation must not discard unfinished work.
    tools().toggleTool('mac')
    expect(tools().open).toEqual(['mac'])
    expect(tools().focused).toBe('mac')

    // Open but not focused: bring it forward rather than dismiss it.
    tools().openTool('mac')
    tools().openTool('pin')
    tools().toggleTool('mac')
    expect(tools().open).toEqual(['mac', 'pin'])
    expect(tools().focused).toBe('mac')
  })

  it('moves focus to a neighbour when the focused tool closes', () => {
    tools().openTool('mac')
    tools().openTool('pin')
    tools().openTool('tlv')

    tools().focusTool('pin')
    tools().closeTool('pin')

    expect(tools().open).toEqual(['mac', 'tlv'])
    expect(tools().focused).toBe('tlv')

    tools().closeTool('tlv')
    expect(tools().focused).toBe('mac')

    tools().closeTool('mac')
    expect(tools().open).toEqual([])
    expect(tools().focused).toBeNull()
  })

  it('focusTool only moves focus between open tools', () => {
    tools().openTool('mac')
    tools().focusTool('crypto')
    expect(tools().open).toEqual(['mac'])
    expect(tools().focused).toBe('mac')
  })

  it('closing an unknown tool is a no-op', () => {
    tools().openTool('mac')
    tools().closeTool('rsa')
    expect(tools().open).toEqual(['mac'])
    expect(tools().focused).toBe('mac')
  })

  it('promote opens and focuses the tool, and closing it un-promotes', () => {
    tools().promote('tlv')
    expect(tools().open).toEqual(['tlv'])
    expect(tools().focused).toBe('tlv')
    expect(tools().promoted).toBe('tlv')

    tools().unpromote()
    expect(tools().promoted).toBeNull()
    expect(tools().open).toEqual(['tlv'])

    tools().promote('tlv')
    tools().closeTool('tlv')
    expect(tools().promoted).toBeNull()
  })
})

describe('tools: persistence allowlist (UX_SPEC 5.5)', () => {
  it('persists the open list and nothing else', () => {
    tools().openTool('mac')
    tools().openTool('pin')
    tools().promote('pin')

    const raw = localStorage.getItem(STORAGE_KEYS.tools)
    expect(raw).not.toBeNull()

    const parsed = JSON.parse(raw ?? '{}') as { v: number; data: Record<string, unknown> }
    expect(Object.keys(parsed.data)).toEqual([...TOOLS_PERSISTED_KEYS])
    expect(parsed.data).toEqual({ open: ['mac', 'pin'] })

    // Session-only state must not be written.
    expect(raw).not.toContain('focused')
    expect(raw).not.toContain('promoted')
  })

  it('writes only its own storage key', () => {
    tools().openTool('mac')

    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key !== null) keys.push(key)
    }
    expect(keys).toEqual([STORAGE_KEYS.tools])
  })
})

describe('tools: hydration', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('restores the open list and focuses the first entry', async () => {
    localStorage.setItem(
      STORAGE_KEYS.tools,
      JSON.stringify({ v: 1, data: { open: ['mac', 'pin'] } }),
    )

    const { useTools: hydrated } = await import('@/store/tools')
    const state = hydrated.getState()

    expect(state.open).toEqual(['mac', 'pin'])
    expect(state.focused).toBe('mac')
    // Never restored from storage.
    expect(state.promoted).toBeNull()
  })

  it('discards junk entries and duplicates rather than trusting storage', async () => {
    localStorage.setItem(
      STORAGE_KEYS.tools,
      JSON.stringify({ v: 1, data: { open: ['mac', 'mac', 42, '', null, 'pin'], focused: 'rsa' } }),
    )

    const { useTools: hydrated } = await import('@/store/tools')
    const state = hydrated.getState()

    expect(state.open).toEqual(['mac', 'pin'])
    expect(state.focused).toBe('mac')
  })

  it('starts empty when storage holds a malformed entry', async () => {
    localStorage.setItem(STORAGE_KEYS.tools, JSON.stringify({ v: 1, data: { open: 'mac' } }))

    const { useTools: hydrated } = await import('@/store/tools')

    expect(hydrated.getState().open).toEqual([])
    expect(hydrated.getState().focused).toBeNull()
  })
})
