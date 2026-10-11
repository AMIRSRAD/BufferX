import { formatJson, inspectJson } from './parser'
self.onmessage = (event: MessageEvent<{ id: number; source: string; format?: 'pretty' | 'compact' }>) => {
  const { id, source, format } = event.data
  const result = inspectJson(source)
  self.postMessage({ id, result, formatted: format && result.ok ? formatJson(source, result.root, format === 'compact') : undefined })
}
