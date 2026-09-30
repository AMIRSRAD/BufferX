import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTools } from '@/store/tools'
import { WorkspaceTabs } from './WorkspaceTabs'
import { ToolDock } from './ToolDock'

vi.mock('@/tools/registry', () => {
  const Panel = () => {
    const [value, setValue] = useState('')
    return <input aria-label="Draft" value={value} onChange={(event) => setValue(event.target.value)} />
  }
  const icon = () => null
  return { getTool: (id: string) => ({ id, title: id.toUpperCase(), icon, Panel }) }
})

beforeEach(() => useTools.setState({ open: [], focused: null, promoted: null }))

function Host({ split = false, canSplit = true }: { split?: boolean; canSplit?: boolean }) {
  return <><WorkspaceTabs split={split} canSplit={canSplit} onToggleSplit={() => {}} />
    <ToolDock split={split} width={480} onWidthChange={() => {}} /></>
}

describe('workspace navigation', () => {
  it('gives only the selected tool a visible panel with many tools open', () => {
    for (const id of ['tlv', 'mac', 'pin', 'crypto', 'rsa', 'network', 'toolbox']) useTools.getState().openTool(id)
    render(<Host />)
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('TOOLBOX')
    expect(screen.getAllByRole('tab')).toHaveLength(8)
    fireEvent.change(screen.getByRole('combobox', { name: 'All workspaces' }), { target: { value: 'tlv' } })
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('TLV')
  })

  it('preserves drafts across navigation, buffer selection and split changes', () => {
    useTools.getState().openTool('tlv')
    const view = render(<Host />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'unfinished draft' } })
    act(() => useTools.getState().openTool('mac'))
    fireEvent.click(screen.getByRole('tab', { name: 'Buffer' }))
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'TLV' }))
    view.rerender(<Host split />)
    expect(screen.getByRole('textbox')).toHaveValue('unfinished draft')
    view.rerender(<Host />)
    expect(screen.getByRole('textbox')).toHaveValue('unfinished draft')
  })

  it('closes explicitly and selects the neighboring workspace', () => {
    useTools.getState().openTool('tlv')
    useTools.getState().openTool('mac')
    render(<Host />)
    fireEvent.click(screen.getByRole('button', { name: 'Close MAC' }))
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('TLV')
    fireEvent.click(screen.getByRole('button', { name: 'Close TLV' }))
    expect(screen.getByRole('tab', { name: 'Buffer' })).toHaveAttribute('aria-selected', 'true')
  })

  it('supports arrow-key navigation and selected tab focus', () => {
    useTools.getState().openTool('tlv')
    useTools.getState().openTool('mac')
    render(<Host />)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'MAC' }), { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: 'TLV' })).toHaveFocus()
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('TLV')
  })

  it('disables split when there is not enough space', () => {
    useTools.getState().openTool('tlv')
    render(<Host canSplit={false} />)
    expect(screen.getByRole('button', { name: 'Split with buffer' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  })
})
