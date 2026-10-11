import { useEffect, useRef } from 'react'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { json } from '@codemirror/lang-json'
import { bracketMatching, HighlightStyle, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { Compartment, EditorState } from '@codemirror/state'
import { Decoration, EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import type { JsonIssue } from './parser'

export function JsonEditor({ value, onChange, issue, reveal }: {
  value: string; onChange(value: string): void; issue?: JsonIssue
  reveal: { from: number; to: number; sequence: number } | null
}) {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange
  const diagnostics = useRef(new Compartment())
  useEffect(() => {
    if (!host.current) return
    const view = new EditorView({ parent: host.current, state: EditorState.create({ doc: value, extensions: [
      json(), history(), lineNumbers(), foldGutter(), bracketMatching(), indentOnInput(), drawSelection(), highlightActiveLine(),
      syntaxHighlighting(HighlightStyle.define([
        { tag: tags.propertyName, color: 'var(--color-accent)' },
        { tag: tags.string, color: 'var(--color-text)' },
        { tag: tags.number, color: 'var(--color-warn)' },
        { tag: [tags.bool, tags.null], color: 'var(--color-accent)' },
        { tag: tags.punctuation, color: 'var(--color-text-secondary)' },
        { tag: tags.invalid, color: 'var(--color-error)' },
      ])), highlightSelectionMatches(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, indentWithTab]),
      EditorView.contentAttributes.of({ 'aria-label': 'JSON source', spellcheck: 'false' }),
      diagnostics.current.of([]),
      EditorView.updateListener.of((update) => { if (update.docChanged) onChangeRef.current(update.state.doc.toString()) }),
      EditorView.theme({
        '&': { height: '100%', color: 'var(--color-text)', backgroundColor: 'var(--color-surface-inset)' },
        '.cm-scroller': { fontFamily: 'var(--font-mono)', fontSize: '14px', overflow: 'auto' },
        '.cm-content': { padding: '12px 0' },
        '.cm-gutters': { backgroundColor: 'var(--color-surface-2)', color: 'var(--color-text-tertiary)', borderColor: 'var(--color-border-subtle)' },
        '.cm-activeLine': { backgroundColor: 'var(--color-surface-raised)' },
        '.bx-json-error-line': { backgroundColor: 'color-mix(in srgb, var(--color-error) 12%, transparent)' },
        '.bx-json-error': { textDecoration: 'underline wavy var(--color-error)', backgroundColor: 'color-mix(in srgb, var(--color-error) 25%, transparent)' },
        '&.cm-focused': { outline: 'none' },
        '.cm-searchMatch': { backgroundColor: 'var(--color-accent-muted)' },
        '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--color-accent-muted)' },
      }),
    ] }) })
    editor.current = view
    return () => { view.destroy(); editor.current = null }
  }, [])
  useEffect(() => {
    const view = editor.current
    if (view && value !== view.state.doc.toString()) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  }, [value])
  useEffect(() => {
    const view = editor.current; if (!view) return
    const marks = []
    if (issue) {
      const from = Math.min(issue.offset, view.state.doc.length)
      marks.push(Decoration.line({ class: 'bx-json-error-line' }).range(view.state.doc.lineAt(from).from))
      if (from < view.state.doc.length) marks.push(Decoration.mark({ class: 'bx-json-error' }).range(from, from + 1))
    }
    view.dispatch({ effects: diagnostics.current.reconfigure(EditorView.decorations.of(Decoration.set(marks, true))) })
  }, [issue, value])
  useEffect(() => {
    const view = editor.current; if (!view || !reveal) return
    const from = Math.min(reveal.from, view.state.doc.length)
    view.dispatch({ selection: { anchor: from, head: Math.min(reveal.to, view.state.doc.length) }, effects: EditorView.scrollIntoView(from, { y: 'center' }) })
    view.focus()
  }, [reveal])
  return <div ref={host} className="h-full min-h-0 overflow-hidden rounded-sm border border-border" />
}
