import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/Tooltip'
import { useBuffers } from '@/store/buffers'
import { usePackagerSource } from '@/tools/settings/packagerSource'
import { stubEngine } from '@/test/setup'
import PackagerPanel from './PackagerPanel'
import { newPackager, packagerXml, parsePackagers } from './model'

beforeEach(() => {
  usePackagerSource.setState({ xml: null, packagers: [], source: null, status: 'idle', error: null })
})

describe('packager builder workflow', () => {
  it('starts an editable new draft and clears the previous filter and error', async () => {
    stubEngine.on('packager.loadXml', () => ({ ok: false, error: { code: 'BAD_ARGUMENT', message: 'Rejected definition' } }))
    render(<TooltipProvider><PackagerPanel /></TooltipProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Clone' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use packager' }))
    await screen.findByText('Rejected definition')
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter fields' }), { target: { value: 'missing field' } })
    fireEvent.click(screen.getByRole('button', { name: /^New$/ }))
    expect(screen.getByRole('textbox', { name: /^Name$/ })).toHaveValue('CUSTOM')
    expect(screen.getByRole('textbox', { name: /^Name$/ })).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Filter fields' })).toHaveValue('')
    expect(screen.queryByText('Rejected definition')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Field id' })).toHaveValue('0')
    expect(screen.getByText(/2 fields · select a row/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }))
    expect(screen.getByRole('textbox', { name: 'Field id' })).toHaveValue('2')
  })
  it('avoids replacing a loaded CUSTOM definition when starting a new draft', () => {
    const custom = newPackager()
    usePackagerSource.setState({ xml: `<Packagers>${packagerXml(custom)}</Packagers>` })
    render(<TooltipProvider><PackagerPanel /></TooltipProvider>)
    fireEvent.click(screen.getByRole('button', { name: /^New$/ }))
    expect(screen.getByRole('textbox', { name: /^Name$/ })).toHaveValue('CUSTOM_2')
    expect(usePackagerSource.getState().xml).toContain('Name="CUSTOM"')
  })
  it('clones a shipped definition, merges the registry, and selects it for the buffer', async () => {
    usePackagerSource.setState({ xml: null, packagers: [], source: null, status: 'idle', error: null })
    useBuffers.getState().newTab()
    stubEngine.on('packager.loadXml', ({ xml }) => {
      const definitions = parsePackagers(String(xml))
      expect(definitions).toHaveLength(33)
      expect(definitions.some((pack) => pack.name === 'SLM')).toBe(true)
      expect(definitions.some((pack) => pack.name === 'SLM_CUSTOM')).toBe(true)
      return { ok: true, data: definitions.map((pack) => ({ name: pack.name })) }
    })
    render(<TooltipProvider><PackagerPanel /></TooltipProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Clone' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use packager' }))
    await waitFor(() => expect(usePackagerSource.getState().status).toBe('ready'))
    const buffers = useBuffers.getState()
    expect(buffers.tabs.find((tab) => tab.id === buffers.activeId)?.packager).toBe('SLM_CUSTOM')
    expect(usePackagerSource.getState().xml).toContain('SLM_CUSTOM')
  })
})
