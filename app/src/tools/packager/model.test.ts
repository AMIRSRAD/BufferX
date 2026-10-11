import { describe, expect, it } from 'vitest'
import builtin from '../../../../data/packagers.xml?raw'
import { mergePackagerXml, newField, newPackager, packagerXml, parsePackagers, validatePackager } from './model'
describe('packager builder', () => {
  it('loads all shipped definitions with their actual wire types and metadata', () => {
    const packs = parsePackagers(builtin)
    expect(packs).toHaveLength(32)
    expect(packs.find((pack) => pack.name === 'SLM')?.fields.find((field) => field.id === '2')).toMatchObject({ type: 'IFA_LLNUM', length: '19' })
  })
  it('exports an escaped definition that round trips and keeps the other 32 packagers', () => {
    const pack = newPackager(); pack.name = 'CUSTOM<&"'; pack.fields[0]!.description = 'hello <&"\nworld'
    expect(validatePackager(pack)).toEqual([])
    const merged = mergePackagerXml(builtin, pack)
    const packs = parsePackagers(merged)
    expect(packs).toHaveLength(33)
    expect(packs.find((entry) => entry.name === pack.name)?.fields[0]!.description).toBe(pack.fields[0]!.description)
    expect(parsePackagers(`<Packagers>${packagerXml(pack)}</Packagers>`)[0]!.name).toBe(pack.name)
  })
  it('replaces only the selected definition, including a standalone XML root', () => {
    const pack = newPackager(); pack.name = 'SLM'
    expect(parsePackagers(mergePackagerXml(builtin, pack))).toHaveLength(32)
    const original = packagerXml(newPackager())
    expect(parsePackagers(mergePackagerXml(original, pack))).toHaveLength(2)
  })
  it('rejects duplicate ids, prefix overflow, unknown types, and missing bitmap definitions', () => {
    const pack = newPackager()
    pack.fields.push({ ...newField(0), type: 'IFA_LLCHAR', length: '100' })
    pack.fields[1]!.type = 'BOGUS'
    const errors = validatePackager(pack).join(' ')
    expect(errors).toContain('duplicate id')
    expect(errors).toContain('variable-length prefix')
    expect(errors).toContain('supported field type')
    expect(errors).toContain('bitmap field')
  })
})
