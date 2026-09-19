/**
 * The XML editor used by the TLV ⇄ XML converter (UX_SPEC 3.5).
 *
 * CodeMirror 6 with the XML language attached, styled entirely from design
 * tokens (DESIGN_SYSTEM §4.13) so it tracks `data-theme` and `data-density`
 * without a second palette.
 *
 * Highlighting is done with a small regex-driven decoration plugin rather than
 * a `HighlightStyle`. A `HighlightStyle` needs `Tag` objects from
 * `@lezer/highlight`, which is not a declared dependency of this app and is not
 * resolvable under pnpm's strict layout; the alternative — CodeMirror's
 * `defaultHighlightStyle` — hardcodes its own colours and would break the "no
 * raw colour" rule in the dark theme. The XML this tool renders is
 * machine-generated `<Tlv><Node …/></Tlv>`, so a scanner over tags, attributes
 * and comments is exact for the documents that actually appear here, and
 * degrades to plain text for anything it does not recognise.
 *
 * Everything else the language gives us is real: folding, bracket matching,
 * auto-indent, `Ctrl+F` search, and full undo history.
 */

import { useEffect, useRef } from 'react'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { xml } from '@codemirror/lang-xml'
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, RangeSetBuilder, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExtension,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { cn } from '@/lib/cn'

/* ── Highlighting ─────────────────────────────────────────────────────────── */

const TAG_CLASS = Decoration.mark({ class: 'bx-xml-tag' })
const ATTR_CLASS = Decoration.mark({ class: 'bx-xml-attr' })
const VALUE_CLASS = Decoration.mark({ class: 'bx-xml-value' })
const COMMENT_CLASS = Decoration.mark({ class: 'bx-xml-comment' })

interface Marked {
  from: number
  to: number
  decoration: Decoration
}

function scan(text: string, offset: number, out: Marked[]): void {
  const commentPattern = /<!--[\s\S]*?(?:-->|$)/g
  const commentSpans: Array<[number, number]> = []
  for (let match = commentPattern.exec(text); match !== null; match = commentPattern.exec(text)) {
    const from = offset + match.index
    const to = from + match[0].length
    commentSpans.push([from, to])
    out.push({ from, to, decoration: COMMENT_CLASS })
  }

  const inComment = (position: number): boolean =>
    commentSpans.some(([from, to]) => position >= from && position < to)

  const tagPattern = /<\/?([A-Za-z_][-\w.:]*)((?:[^<>"']|"[^"]*"|'[^']*')*)>/g
  for (let match = tagPattern.exec(text); match !== null; match = tagPattern.exec(text)) {
    const tagStart = offset + match.index
    if (inComment(tagStart)) continue

    const name = match[1] ?? ''
    const attributes = match[2] ?? ''
    const nameStart = tagStart + match[0].indexOf(name, 1)
    out.push({ from: nameStart, to: nameStart + name.length, decoration: TAG_CLASS })

    const attributeOffset = nameStart + name.length
    const attrPattern = /([A-Za-z_][-\w.:]*)(\s*=\s*)("[^"]*"|'[^']*')/g
    for (let attr = attrPattern.exec(attributes); attr !== null; attr = attrPattern.exec(attributes)) {
      const key = attr[1] ?? ''
      const gap = attr[2] ?? ''
      const value = attr[3] ?? ''
      const keyStart = attributeOffset + attr.index
      out.push({ from: keyStart, to: keyStart + key.length, decoration: ATTR_CLASS })
      const valueStart = keyStart + key.length + gap.length
      out.push({ from: valueStart, to: valueStart + value.length, decoration: VALUE_CLASS })
    }
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const marks: Marked[] = []
  for (const { from, to } of view.visibleRanges) {
    scan(view.state.doc.sliceString(from, to), from, marks)
  }
  // A RangeSetBuilder demands sorted, non-decreasing starts.
  marks.sort((left, right) => left.from - right.from || left.to - right.to)

  const builder = new RangeSetBuilder<Decoration>()
  let lastFrom = -1
  for (const mark of marks) {
    if (mark.to <= mark.from || mark.from < lastFrom) continue
    builder.add(mark.from, mark.to, mark.decoration)
    lastFrom = mark.from
  }
  return builder.finish()
}

const xmlHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

/* ── Theme ────────────────────────────────────────────────────────────────── */

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--color-text)',
    backgroundColor: 'var(--color-surface-inset)',
    fontSize: 'var(--text-mono-sm)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: 'var(--text-mono-sm--line-height)',
    overscrollBehavior: 'contain',
  },
  '.cm-content': { padding: '6px 0', caretColor: 'var(--color-accent)' },
  '.cm-line': { padding: '0 8px' },
  '.cm-gutters': {
    backgroundColor: 'var(--color-surface-inset)',
    color: 'var(--color-text-tertiary)',
    border: 'none',
    borderRight: '1px solid var(--color-border-subtle)',
    fontSize: 'var(--text-mono-xs)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'var(--color-surface-raised)', color: 'var(--color-text-secondary)' },
  '.cm-activeLine': { backgroundColor: 'var(--color-surface-raised)' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text-secondary)',
    padding: '0 4px',
    borderRadius: 'var(--radius-xs)',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--color-accent-muted)',
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--color-hl-5-bg)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--color-accent-muted)',
    outline: 'none',
  },
  '.cm-nonmatchingBracket': { backgroundColor: 'var(--color-error-bg)' },
  '.cm-placeholder': { color: 'var(--color-text-tertiary)' },
  '.cm-panels': {
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    border: 'none',
    borderTop: '1px solid var(--color-border)',
  },
  '.cm-panel input, .cm-panel button': {
    backgroundColor: 'var(--color-surface-1)',
    color: 'var(--color-text)',
    border: '1px solid var(--color-border-strong)',
    borderRadius: 'var(--radius-xs)',
  },
  '.bx-xml-tag': { color: 'var(--color-hl-6)' },
  '.bx-xml-attr': { color: 'var(--color-hl-5)' },
  '.bx-xml-value': { color: 'var(--color-hl-3)' },
  '.bx-xml-comment': { color: 'var(--color-text-tertiary)', fontStyle: 'italic' },
})

/* ── Component ────────────────────────────────────────────────────────────── */

export interface XmlEditorProps {
  value: string
  onValueChange: (value: string) => void
  readOnly?: boolean
  placeholder?: string
  /** Required: the editor is a form control and must be named. */
  ariaLabel: string
  className?: string
}

export function XmlEditor({
  value,
  onValueChange,
  readOnly = false,
  placeholder = '',
  ariaLabel,
  className,
}: XmlEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onValueChange)
  const readOnlyCompartment = useRef(new Compartment())

  onChangeRef.current = onValueChange

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      foldGutter(),
      drawSelection(),
      history(),
      indentOnInput(),
      bracketMatching(),
      highlightSelectionMatches(),
      xml(),
      xmlHighlighter,
      EditorView.lineWrapping,
      editorTheme,
      placeholderExtension(placeholder),
      EditorView.contentAttributes.of({ 'aria-label': ariaLabel, spellcheck: 'false' }),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, indentWithTab]),
      readOnlyCompartment.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current(update.state.doc.toString())
      }),
    ]

    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: host,
    })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // The editor is created once; `value`, `readOnly` and the label are pushed
    // in by the effects below. Re-creating it on every keystroke would drop the
    // selection, the fold state and the undo history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Push external value changes in without clobbering the cursor on echoes of
  // our own edits.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    })
  }, [readOnly])

  return (
    <div
      ref={hostRef}
      className={cn(
        'min-h-0 flex-1 overflow-hidden rounded-sm border border-border bg-surface-inset',
        'focus-within:border-accent focus-within:shadow-focus',
        className,
      )}
    />
  )
}
