import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/Tooltip'
import { useLibrary } from '@/store/library'
import { LibraryLocation } from '@/tools/settings/LibraryLocation'
import LibraryPanel from './LibraryPanel'

const mocks = vi.hoisted(() => ({ defaultFolder: vi.fn(), list: vi.fn(), pick: vi.fn() }))
vi.mock('./libraryFiles', async (original) => ({ ...await original<typeof import('./libraryFiles')>(), canUseLibrary: () => true, defaultLibraryFolder: mocks.defaultFolder, listLibrary: mocks.list, pickLibraryFolder: mocks.pick }))
beforeEach(() => {
  useLibrary.setState({ folder: null, notes: {} })
  mocks.defaultFolder.mockReset().mockResolvedValue('C:/BufferX/saved-buffers')
  mocks.list.mockReset().mockResolvedValue({ status: 'ok', files: [] })
  mocks.pick.mockReset().mockResolvedValue({ status: 'ok', folder: 'D:/Messages' })
})
describe('library folder preferences', () => {
  it('opens beside the executable without persisting an absolute default', async () => {
    render(<TooltipProvider><LibraryPanel /></TooltipProvider>)
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith('C:/BufferX/saved-buffers', 'bxb'))
    expect(useLibrary.getState().folder).toBeNull()
  })
  it('opens the configured folder directly', async () => {
    useLibrary.setState({ folder: 'D:/Messages' })
    render(<TooltipProvider><LibraryPanel /></TooltipProvider>)
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith('D:/Messages', 'bxb'))
    expect(mocks.defaultFolder).not.toHaveBeenCalled()
  })
  it('lets settings choose an override and restore the portable default', async () => {
    render(<LibraryLocation />)
    await screen.findByText('C:/BufferX/saved-buffers')
    expect(mocks.defaultFolder).toHaveBeenCalledWith(false)
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder…' }))
    await waitFor(() => expect(useLibrary.getState().folder).toBe('D:/Messages'))
    fireEvent.click(screen.getByRole('button', { name: 'Use default folder' }))
    expect(useLibrary.getState().folder).toBeNull()
  })
  it('shows a default-folder failure with a folder chooser', async () => {
    mocks.defaultFolder.mockRejectedValue(new Error('Access denied. Choose another folder in Settings.'))
    render(<TooltipProvider><LibraryPanel /></TooltipProvider>)
    await screen.findByText('Access denied. Choose another folder in Settings.')
    expect(screen.getByRole('button', { name: /Choose folder/ })).toBeInTheDocument()
  })
})
