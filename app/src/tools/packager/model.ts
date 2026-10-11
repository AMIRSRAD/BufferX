export const FIELD_TYPES = [
  'IFA_NUMERIC', 'IFB_NUMERIC', 'IF_CHAR', 'IFA_CHAR', 'IFA_AMOUNT', 'IFA_BITMAP', 'IFB_BITMAP',
  'IFA_BINARY', 'IFB_BINARY', 'IFA_LLNUM', 'IFA_LLLNUM', 'IFB_LLNUM_BCD', 'IFB_LLNUM_PAN_HC',
  'IFA_LLCHAR', 'IFB_LLCHAR', 'IFA_LLLCHAR', 'IFB_LLLCHAR', 'IFA_LLLLCHAR', 'IFA_HHHHCHAR',
  'IFA_LLLLLCHAR', 'IFA_LLLLLLCHAR', 'IFA_L7CHAR', 'IFA_LLBINARY', 'IFB_LLBINARY',
  'IFA_LLLBINARY', 'IFB_LLLBINARY', 'IFA_LLLLBINARY', 'IFB_LLLLBINARY',
] as const
export interface BuilderField { uid: string; id: string; type: string; length: string; description: string; flags: string }
export interface BuilderPackager {
  name: string; macMethod: string; macSize: string; bitmapIndex: string; secondPartBitmap: string
  fieldCount: string; lenFormat: string; lenLen: string; fields: BuilderField[]
}
export function newField(id: number): BuilderField { return { uid: crypto.randomUUID(), id: String(id), type: 'IF_CHAR', length: '1', description: '', flags: '00' } }
export function newPackager(): BuilderPackager {
  return { name: 'CUSTOM', macMethod: 'FULL', macSize: '16', bitmapIndex: '1', secondPartBitmap: '64', fieldCount: '128', lenFormat: '', lenLen: '4', fields: [
    { ...newField(0), type: 'IFA_NUMERIC', length: '4', description: 'MESSAGE TYPE INDICATOR' },
    { ...newField(1), type: 'IFA_BITMAP', length: '128', description: 'BIT MAP' },
  ] }
}
export function parsePackagers(xml: string): BuilderPackager[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('Invalid XML. Check the document syntax.')
  const packagers = Array.from(doc.querySelectorAll('Packager')).map((element) => {
    const attr = (name: string, fallback: string) => element.getAttribute(name) ?? fallback
    return { name: attr('Name', ''), macMethod: attr('MacMethod', ''), macSize: attr('MacSize', '0'), bitmapIndex: attr('BitmapIndex', '1'), secondPartBitmap: attr('SecondPartBitmap', '64'), fieldCount: attr('FieldCount', '64'), lenFormat: attr('LenFormat', ''), lenLen: attr('LenLen', '0'), fields: Array.from(element.children).filter((child) => child.tagName === 'Field').map((field) => ({ uid: crypto.randomUUID(), id: field.getAttribute('FieldId') ?? '', type: field.getAttribute('FieldType') ?? '', length: field.getAttribute('FieldLength') ?? '0', description: field.getAttribute('FieldDesc') ?? '', flags: field.getAttribute('Flags') ?? '' })) }
  })
  if (!packagers.length) throw new Error('No Packager elements found.')
  return packagers
}
export function validatePackager(pack: BuilderPackager): string[] {
  const errors: string[] = []
  const integer = (value: string, min: number, max: number) => /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max
  if (!pack.name.trim()) errors.push('Give the packager a name.')
  if (!integer(pack.fieldCount, 1, 192)) errors.push('Field count must be between 1 and 192.')
  if (!['-1', '0', '1'].includes(pack.bitmapIndex)) errors.push('Bitmap index must be -1, 0, or 1.')
  if (!integer(pack.secondPartBitmap, 0, 192)) errors.push('Second bitmap boundary must be between 0 and 192.')
  if (!integer(pack.lenLen, 0, 8)) errors.push('Length header width must be between 0 and 8.')
  if (!integer(pack.macSize, 0, 32)) errors.push('MAC size must be between 0 and 32 hex characters.')
  if (!pack.fields.length) errors.push('Add at least one field.')
  const ids = new Set<number>()
  for (const field of pack.fields) {
    if (!integer(field.id, 0, Number(pack.fieldCount))) errors.push(`Field ${field.id || '(empty)'}: id is outside the packager range.`)
    if (ids.has(Number(field.id))) errors.push(`Field ${field.id}: duplicate id.`)
    ids.add(Number(field.id))
    if (!(FIELD_TYPES as readonly string[]).includes(field.type)) errors.push(`Field ${field.id}: choose a supported field type.`)
    if (!integer(field.length, 1, 10_000_000)) errors.push(`Field ${field.id}: length must be a positive integer.`)
    const digits = /_L(L*)/.exec(field.type)
    if (digits && Number(field.length) > 10 ** (1 + digits[1]!.length) - 1) errors.push(`Field ${field.id}: length exceeds its variable-length prefix.`)
  }
  if (pack.bitmapIndex === '1' && !ids.has(0)) errors.push('An ISO message needs field 0 for its MTI.')
  if (pack.bitmapIndex !== '-1' && !pack.fields.some((field) => field.id === pack.bitmapIndex && field.type.endsWith('_BITMAP'))) errors.push(`Define a bitmap field at index ${pack.bitmapIndex}.`)
  return errors
}
function escape(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r/g, '&#13;').replace(/\n/g, '&#10;') }
export function packagerXml(pack: BuilderPackager): string {
  const attrs = { Name: pack.name.trim(), MacMethod: pack.macMethod, MacSize: pack.macSize, BitmapIndex: pack.bitmapIndex, SecondPartBitmap: pack.secondPartBitmap, FieldCount: pack.fieldCount, LenFormat: pack.lenFormat, LenLen: pack.lenLen }
  const attributes = (values: Record<string, string>) => Object.entries(values).map(([key, value]) => `${key}="${escape(value)}"`).join(' ')
  return `<Packager ${attributes(attrs)}>\n${[...pack.fields].sort((a, b) => Number(a.id) - Number(b.id)).map((field) => `  <Field ${attributes({ FieldId: field.id, FieldType: field.type, FieldLength: field.length, FieldDesc: field.description, Flags: field.flags })} />`).join('\n')}\n</Packager>`
}
/** Preserve the original registry verbatim except for the explicitly replaced definition. */
export function mergePackagerXml(xml: string, pack: BuilderPackager): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('The current packager registry is invalid XML.')
  const replacement = new DOMParser().parseFromString(packagerXml(pack), 'application/xml').documentElement
  const existing = Array.from(doc.querySelectorAll('Packager')).find((node) => node.getAttribute('Name') === pack.name.trim())
  if (existing) existing.replaceWith(doc.importNode(replacement, true))
  else if (doc.documentElement.tagName === 'Packager') {
    const wrapper = doc.createElement('Packagers'); const original = doc.documentElement
    doc.replaceChild(wrapper, original); wrapper.append(original, doc.importNode(replacement, true))
  } else doc.documentElement.appendChild(doc.importNode(replacement, true))
  return new XMLSerializer().serializeToString(doc)
}
