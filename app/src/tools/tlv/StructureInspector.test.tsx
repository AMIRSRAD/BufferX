import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/Tooltip'
import { normalizeParse } from './model'
import { StructureInspector } from './StructureInspector'

// jsdom has no viewport for the virtual table; keep its row-selection contract.
vi.mock('@/components/ui/DataTable', () => ({ DataTable: ({ rows, onSelect }: {
  rows: { id: string; tagHex: string }[]; onSelect(id: string): void
}) => <div>{rows.map((row) => <button key={row.id} onClick={() => onSelect(row.id)}>{row.tagHex}</button>)}</div> }))

describe('visual BER byte offsets', () => {
  it('uses original long lengths for constructed values and following records', () => {
    const nodes = normalizeParse({ nodes: [
      { tag: 'E1', length: 3, value: '', ascii: '', composite: true, children: [
        { tag: '5A', length: 1, value: 'FF', ascii: '', composite: false, children: [] },
      ] },
      { tag: '9F 02', length: 1, value: 'AB', ascii: '', composite: false, children: [] },
    ], tree: '', flat: [], inline: '' })
    render(<TooltipProvider><StructureInspector nodes={nodes} sourceHex="E181045A8101FF9F0201AB" /></TooltipProvider>)
    expect(screen.getByText('81 04')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '9F02' }))
    expect(screen.getByText('@7')).toBeInTheDocument()
    expect(screen.getByText('@10')).toBeInTheDocument()
    expect(screen.getByText('AB')).toBeInTheDocument()
  })
})
