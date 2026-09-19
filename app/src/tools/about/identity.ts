/**
 * Product identity, credits and licence copy for the About tool (UX_SPEC 3.9 →
 * Diagnostics / About, Appendix A → Info).
 *
 * Everything the old Info popover carried lives here as data rather than as
 * markup, so the same strings feed the panel, the licence dialog and the
 * `Copy diagnostics` report without drifting apart. The two strings the spec
 * quotes verbatim -- the creator's name and the ownership statement -- are
 * marked as such and must not be reworded.
 */

export interface ProductIdentity {
  name: string
  tagline: string
  /** Used when the build does not inject a version. Tracks `package.json`. */
  fallbackVersion: string
  creator: string
  website: string
  /** Verbatim, UX_SPEC 3.9. Do not reword. */
  ownership: string
  copyright: string
}

export const PRODUCT: ProductIdentity = {
  name: 'BufferX',
  tagline: 'ISO 8583 and banking cryptography workbench',
  fallbackVersion: '2.0.0',
  creator: 'Amirsalar Saberi rad',
  website: 'https://amirsrad.ir',
  ownership: 'All rights, ownership, and licensing for this app belong to Amirsalar Saberi rad.',
  copyright: 'Copyright (c) 2026 Amirsalar Saberi rad. All rights reserved.',
}

/** One line, shown in the panel body above the `Licence text` control. */
export const LICENCE_SUMMARY =
  'Proprietary. All rights reserved. Provided for viewing and reference only — no permission ' +
  'is granted to use, copy, modify, distribute, sublicense or sell it without prior written ' +
  'permission from the copyright holder.'

/** The shipped `LICENSE`, paragraph by paragraph, for the licence dialog. */
export const LICENCE_TEXT: readonly string[] = [
  'Copyright (c) 2026 Amirsalar Saberi rad',
  'All rights reserved.',
  'This software, including its source code, assets, documentation, and related materials, is the exclusive property of Amirsalar Saberi rad.',
  'No permission is granted to use, copy, modify, merge, publish, distribute, sublicense, sell, or create derivative works from this software, in whole or in part, without prior written permission from Amirsalar Saberi rad.',
  'This repository is provided for viewing and reference only unless explicit written permission is granted by the copyright holder.',
  'Website: https://amirsrad.ir',
]

/** The licence as plain text, for the copy button on the licence dialog. */
export const LICENCE_PLAIN_TEXT: string = LICENCE_TEXT.join('\n\n')

export interface DocumentReference {
  title: string
  /** Repository-relative path. The docs ship with the source, not on a CDN. */
  path: string
  summary: string
}

/**
 * The documentation set. These are repository paths rather than URLs on
 * purpose: BufferX publishes no docs site, and inventing one would be a link
 * that breaks the first time an operator follows it.
 */
export const DOCUMENTS: readonly DocumentReference[] = [
  {
    title: 'README',
    path: 'README.md',
    summary: 'What BufferX is, how to build it, and what ships in each host.',
  },
  {
    title: 'Architecture',
    path: 'docs/ARCHITECTURE.md',
    summary: 'The C++ core, the C ABI, and the two transports above it.',
  },
  {
    title: 'Engine contract',
    path: 'docs/ENGINE_CONTRACT.md',
    summary: 'Every engine operation, its arguments and its result shape.',
  },
  {
    title: 'UX specification',
    path: 'docs/UX_SPEC.md',
    summary: 'The authoritative description of every surface in this app.',
  },
  {
    title: 'Design system',
    path: 'docs/DESIGN_SYSTEM.md',
    summary: 'Tokens, primitives, motion, and the accessibility rules.',
  },
]

/**
 * The persistence guarantee restated where an operator can read it before
 * pressing `Copy diagnostics` (UX_SPEC 5.5 rule 3).
 */
export const DIAGNOSTICS_GUARANTEE =
  'The report carries versions, host capabilities, layout state, the packager path and hash, ' +
  'and the Problems log with secret-bearing values redacted. Keys, PINs, PANs, PEM material ' +
  'and buffer contents are never included.'
