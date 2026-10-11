/** Source ranges preserve number spelling and duplicate keys, even for large integers. */
export interface JsonNode {
  id: number
  key: string
  path: string
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'
  from: number
  to: number
  preview: string
  children: JsonNode[]
}
export interface JsonIssue { message: string; offset: number; line: number; column: number }
export type JsonResult = { ok: true; root: JsonNode; count: number } | { ok: false; error: JsonIssue }

export function inspectJson(source: string): JsonResult {
  let pos = 0
  let count = 0
  const fail = (message: string): never => { throw { message, offset: pos } }
  const whitespace = () => { while (pos < source.length && /[ \t\r\n]/.test(source[pos]!)) pos++ }
  function string(): string {
    const start = pos++
    while (pos < source.length) {
      const ch = source[pos++]!
      if (ch === '"') return JSON.parse(source.slice(start, pos)) as string
      if (ch.charCodeAt(0) < 32) { pos--; fail('Unescaped control character in string. Use a JSON escape such as \\n.') }
      if (ch === '\\') {
        if (pos >= source.length) fail('Incomplete string escape.')
        const escape = source[pos++]!
        if (escape === 'u') {
          for (let digit = 0; digit < 4; digit++, pos++) if (!/[0-9a-fA-F]/.test(source[pos] ?? '')) fail('A Unicode escape needs four hex digits.')
        } else if (!'"\\/bfnrt'.includes(escape)) { pos--; fail('Invalid string escape.') }
      }
    }
    return fail('Unterminated string. Add a closing double quote.')
  }
  function value(key: string, path: string, depth: number): JsonNode {
    whitespace()
    if (depth > 512) fail('Nesting exceeds 512 levels. Reduce nesting to inspect this document.')
    const from = pos
    const id = count++
    if (count > 500_000) fail('Document exceeds 500,000 values. Split it into smaller documents.')
    const children: JsonNode[] = []
    let type: JsonNode['type']
    let preview = ''
    const ch = source[pos]
    if (ch === '{' || ch === '[') {
      type = ch === '{' ? 'object' : 'array'
      const close = ch === '{' ? '}' : ']'
      pos++; whitespace()
      if (source[pos] !== close) {
        for (;;) {
          let childKey = String(children.length)
          if (type === 'object') {
            if (source[pos] !== '"') fail('Expected a property name in double quotes.')
            childKey = string(); whitespace()
            if (source[pos] !== ':') fail('Expected a colon after the property name.')
            pos++
          }
          const segment = childKey.replace(/~/g, '~0').replace(/\//g, '~1')
          children.push(value(childKey, `${path}/${segment}`, depth + 1))
          whitespace()
          if (source[pos] === close) break
          if (source[pos] !== ',') fail(`Expected a comma or '${close}'.`)
          pos++; whitespace()
          if (source[pos] === close) fail('Trailing commas are not allowed in JSON.')
        }
      }
      pos++
      preview = `${children.length} ${type === 'object' ? 'properties' : 'items'}`
    } else if (ch === '"') {
      type = 'string'; preview = string().slice(0, 180)
    } else if (ch === '-' || (ch !== undefined && /[0-9]/.test(ch))) {
      type = 'number'
      if (source[pos] === '-') pos++
      if (source[pos] === '0') pos++
      else {
        if (!/[1-9]/.test(source[pos] ?? '')) fail('Expected a digit after the minus sign.')
        while (/[0-9]/.test(source[pos] ?? '')) pos++
      }
      if (source[pos] === '.') {
        pos++
        if (!/[0-9]/.test(source[pos] ?? '')) fail('Expected a digit after the decimal point.')
        while (/[0-9]/.test(source[pos] ?? '')) pos++
      }
      if (/[eE]/.test(source[pos] ?? '')) {
        pos++
        if (/[+-]/.test(source[pos] ?? '')) pos++
        if (!/[0-9]/.test(source[pos] ?? '')) fail('Expected an exponent digit.')
        while (/[0-9]/.test(source[pos] ?? '')) pos++
      }
      preview = source.slice(from, pos)
    } else {
      const literal = ch === 't' ? 'true' : ch === 'f' ? 'false' : ch === 'n' ? 'null' : null
      if (!literal) fail(pos >= source.length ? 'Expected a JSON value before the end of the document.' : 'Expected an object, array, string, number, true, false, or null.')
      for (const expected of literal!) { if (source[pos] !== expected) fail(`Expected '${literal}'.`); pos++ }
      type = literal === 'null' ? 'null' : 'boolean'; preview = literal!
    }
    return { id, key, path, type, from, to: pos, preview, children }
  }
  try {
    const root = value('$', '', 0)
    whitespace()
    if (pos !== source.length) fail('Unexpected content after the JSON value.')
    return { ok: true, root, count }
  } catch (cause) {
    const issue = cause as { message?: string; offset?: number }
    const offset = issue.offset ?? pos
    const before = source.slice(0, offset)
    const lines = before.split(/\r\n?|\n/)
    const line = lines.length
    const column = lines[lines.length - 1]!.length + 1
    return { ok: false, error: { message: issue.message ?? 'Could not parse JSON.', offset, line, column } }
  }
}

/** Formats source tokens without converting numbers to IEEE doubles. */
export function formatJson(source: string, root: JsonNode, compact = false): string {
  function render(node: JsonNode, depth: number): string {
    if (node.type !== 'object' && node.type !== 'array') return source.slice(node.from, node.to)
    const object = node.type === 'object'
    const open = object ? '{' : '['; const close = object ? '}' : ']'
    if (node.children.length === 0) return open + close
    const rows = node.children.map((child) => `${compact ? '' : '  '.repeat(depth + 1)}${object ? JSON.stringify(child.key) + (compact ? ':' : ': ') : ''}${render(child, depth + 1)}`)
    return compact ? open + rows.join(',') + close : `${open}\n${rows.join(',\n')}\n${'  '.repeat(depth)}${close}`
  }
  return render(root, 0)
}
