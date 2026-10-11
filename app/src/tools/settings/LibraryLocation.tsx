import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { useLibrary } from '@/store/library'
import { canUseLibrary, defaultLibraryFolder, pickLibraryFolder } from '@/tools/library/libraryFiles'
import { SectionCard } from './parts'

export function LibraryLocation() {
  const folder = useLibrary((state) => state.folder)
  const [defaultPath, setDefaultPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const available = canUseLibrary()
  useEffect(() => {
    if (!available) return
    let cancelled = false
    void defaultLibraryFolder(false).then((path) => { if (!cancelled) setDefaultPath(path) })
      .catch((cause: unknown) => { if (!cancelled) setError(String(cause)) })
    return () => { cancelled = true }
  }, [available])
  async function choose() {
    setBusy(true)
    const result = await pickLibraryFolder()
    setBusy(false)
    if (result.status === 'ok') { useLibrary.getState().setFolder(result.folder); setError(null) }
    else if (result.status === 'error') setError(result.message)
  }
  return <SectionCard title="Saved buffer library" description="Defaults to saved-buffers beside the executable. Choose a different folder to keep your library elsewhere.">
    <p className="break-all font-mono text-sm text-text-secondary">{available ? folder ?? defaultPath ?? 'Preparing default folder…' : 'Folder libraries require the desktop app.'}</p>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={!available} loading={busy} onClick={() => void choose()}>Choose folder…</Button>
      <Button size="sm" disabled={!available || !defaultPath || folder === null} onClick={() => { useLibrary.getState().setFolder(null); setError(null) }}>Use default folder</Button>
    </div>
    {error && <InlineAlert tone="error" title="Folder unavailable">{error}</InlineAlert>}
  </SectionCard>
}
