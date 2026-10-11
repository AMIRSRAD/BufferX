import { describe, expect, it } from 'vitest'
import { formatJson, inspectJson } from './parser'

describe('JSON source inspection', () => {
  it.each([
    ['{\n  "a": 1,\n}', 12, 'Trailing commas'],
    ['{"a" 1}', 5, 'colon'],
    ['[1 2]', 3, 'comma'],
    ['{"x":"\\q"}', 7, 'escape'],
    ['[1e+]', 4, 'exponent'],
    ['[01]', 2, 'comma'],
    ['{"x":"abc}', 10, 'Unterminated'],
    ['true false', 5, 'Unexpected content'],
  ])('locates invalid JSON exactly: %s', (source, offset, message) => {
    const result = inspectJson(source)
    expect(result.ok).toBe(false)
    if (!result.ok) { expect(result.error.offset).toBe(offset); expect(result.error.message).toContain(message) }
  })
  it('reports line and column and source ranges using editor offsets', () => {
    for (const newline of ['\r\n', '\r', '\n']) {
      const invalid = inspectJson(`{${newline} "x": }`)
      if (invalid.ok) throw new Error('Expected an invalid object')
      expect(invalid.error).toMatchObject({ line: 2, column: 7 })
    }
    const result = inspectJson('{\n "😀": [true, ]\n}')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatchObject({ line: 2, column: 15 })
    const valid = inspectJson('{"a/b~c": [true]}')
    if (!valid.ok) throw new Error('Expected valid fixture')
    const child = valid.root.children[0]!.children[0]!
    expect(child.path).toBe('/a~1b~0c/0')
    expect('{"a/b~c": [true]}'.slice(child.from, child.to)).toBe('true')
  })
  it('formats without rounding large numbers or discarding duplicate keys', () => {
    const source = '{"id":900719925474099312345,"id":1e+100,"zero":-0}'
    const result = inspectJson(source)
    if (!result.ok) throw new Error('Expected valid fixture')
    const pretty = formatJson(source, result.root)
    expect(pretty).toContain('900719925474099312345')
    expect(pretty).toContain('1e+100')
    expect(pretty).toContain('-0')
    expect(formatJson(source, result.root, true)).toBe(source)
  })
  it('handles large arrays and bounds deeply nested input', () => {
    const result = inspectJson(`[${Array.from({ length: 50_000 }, (_, index) => index).join(',')}]`)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.count).toBe(50_001)
    const nested = inspectJson('['.repeat(514) + '0' + ']'.repeat(514))
    expect(nested.ok).toBe(false)
    if (!nested.ok) expect(nested.error.message).toContain('512')
  })
  it.each(['null', 'true', 'false', '0', '-0.25e+3', '"\\u0061"', '{}', '[]', '[{},[],null,true,false,1,"x"]'])('accepts valid JSON %s', (source) => expect(inspectJson(source).ok).toBe(true))
})
