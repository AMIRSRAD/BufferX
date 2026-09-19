# BufferX Design System — "Precision Instrument"

**Status:** pre-implementation design spec, not a live reference. It was written to pin down the visual language before `src/styles/app.css` and the component library existed. Two things changed for real reasons during implementation and were never folded back into this document: the mono typeface (JetBrains Mono Variable shipped, not IBM Plex Mono — see the corrected note in §2.1) plus Vazirmatn Variable for Persian text, which this spec does not mention at all; and the type scale and density tokens were bumped up one step after the shipped 11–13px baseline proved too small in real use (dense-row height 24px → 28px, UI baseline 13px → 14px). For the tokens as they actually ship, read `app/src/styles/app.css` and `app/src/styles/fonts.css` directly — they are short, and they are the real source of truth now. Sections on color, layout, motion, and component anatomy below were not revisited and should be closer to what shipped, but treat any specific pixel or token value here as a starting point to verify against the CSS, not a citation.

**Audience:** implementers. Everything here is meant to be pasted into `src/styles/app.css` and `src/components/*`. Nothing here is aspirational.

---

## 0. Principles

1. **Density is a feature, not a compromise.** The operator is reading 512 bytes of hex against a 128-field bitmap. Whitespace that does not carry meaning is deleted.
2. **Every byte is addressable.** Nothing important is conveyed by color alone, by hover alone, or by a truncated single-line status bar. Position, offset, and field identity are always literally on screen.
3. **Mono is the default for data, never for chrome.** If a glyph's column position matters, it is monospace. If it is a word for a human, it is UI type.
4. **No destructive surprise.** Anything that overwrites operator input announces itself, is undoable, or asks first. (The Qt app's `Clear`, `Decode`-overwrites-PIN, and `Encrypt`-destroys-signature behaviors are design bugs this system exists to prevent.)
5. **Secrets are a material, not a string.** PINs, PANs, keys, and PEMs get a dedicated input type with masking, no-persist semantics, and redaction hooks. They never enter a URL, a log, a toast, a recent-commands list, or `localStorage`.
6. **Light theme is not an afterthought.** Every token, every state, every contrast ratio is specified twice and tested twice.

---

## 1. Color

### 1.1 Model

All colors are authored in **OKLCH**. Reasons: perceptual lightness `L` is directly comparable across hues (so we can guarantee legibility by construction), chroma can be held constant while rotating hue (so the 8-hue field palette is perceptually even), and light/dark parity becomes an `L` reflection rather than a hand-tuned second palette.

Tokens are **semantic only**. No component may reference a raw hue. There is no `--color-teal-400` in the public surface; there is `--color-accent`.

Theme is switched by `data-theme` on `<html>`. **`data-theme` is always present** — the shell writes it before first paint. Dark is the default and the fallback.

### 1.2 Contrast targets

| Content | Target | Floor (hard requirement) |
|---|---|---|
| Body text, labels, table cells, hex bytes | **7:1 (AAA)** where achievable | **4.5:1 (WCAG AA 1.4.3)** |
| Large text ≥ 24px, or ≥ 18.66px bold | 4.5:1 | **3:1** |
| Interactive control boundaries (input/select/checkbox borders), focus ring, status dots, byte-run strokes, divider between two interactive regions | 4.5:1 | **3:1 (WCAG AA 1.4.11)** |
| Decorative hairlines that separate rows of the *same* component | — | exempt (1.4.11 note) |
| Disabled control text | — | exempt by 1.4.3; we hold a self-imposed **2.7:1** floor so disabled state is still readable, and disabled is *always* also signalled by cursor + `aria-disabled` + reduced opacity |

Ratios below were computed against sRGB relative luminance using the standard WCAG formula. Every pair listed is verified.

**Verified text pairs — dark theme** (background → foreground):

| Pair | Ratio | Level |
|---|---|---|
| `surface-0` → `text-primary` | 13.0:1 | AAA |
| `surface-1` → `text-primary` | 11.5:1 | AAA |
| `surface-2` → `text-primary` | 10.1:1 | AAA |
| `surface-3` → `text-primary` | 9.1:1 | AAA |
| `surface-1` → `text-secondary` | 7.3:1 | AAA |
| `surface-2` → `text-secondary` | 6.4:1 | AA+ |
| `surface-3` → `text-tertiary` | 4.7:1 | AA |
| `surface-inset` → `text-primary` | 13.7:1 | AAA |
| `surface-1` → `accent` | 7.1:1 | AAA |
| `surface-1` → `ok` | 7.5:1 | AAA |
| `surface-1` → `warn` | 7.9:1 | AAA |
| `surface-1` → `error` | 5.9:1 | AA+ |
| `surface-1` → `info` | 7.1:1 | AAA |
| `accent` → `accent-fg` | 7.7:1 | AAA |
| `surface-1` → `border-strong` | 3.8:1 | AA (non-text) |
| `surface-2` → `border-strong` | 3.3:1 | AA (non-text) |

**Verified text pairs — light theme:**

| Pair | Ratio | Level |
|---|---|---|
| `surface-1` → `text-primary` | 12.2:1 | AAA |
| `surface-2` → `text-primary` | 10.7:1 | AAA |
| `surface-inset` → `text-primary` | 10.2:1 | AAA |
| `surface-1` → `text-secondary` | 5.9:1 | AA+ |
| `surface-inset` → `text-secondary` | 5.0:1 | AA+ |
| `surface-inset` → `text-tertiary` | 4.6:1 | AA |
| `surface-inset` → `accent` | 4.6:1 | AA |
| `surface-inset` → `ok` / `warn` / `error` / `info` | 4.6:1 | AA |
| `accent` → `accent-fg` | 5.4:1 | AA+ |
| `surface-2` → `border-strong` | 3.3:1 | AA (non-text) |

`text-tertiary` is the tightest pair in both themes and is deliberately pinned at the AA boundary against the *darkest* (dark theme: `surface-3`) / *lightest-inverted* (light theme: `surface-inset`) background it is ever allowed on. **`text-tertiary` is forbidden on any surface not listed.** `text-disabled` is 3.1:1 (dark, on `surface-2`) / 2.9:1 (light, on `surface-2`).

### 1.3 Field / byte highlight palette

Eight hues, used to color-code ISO 8583 field runs inside the hex viewer, the bitmap view, and the field table's identity stripe. Requirements and how they are met:

- **Distinguishable under deuteranopia and protanopia.** The long-wavelength hues (red 30°, amber 78°, olive 118°, green 150°) collapse toward a single yellow axis for these observers. They are therefore **staggered in lightness** by ≥ 0.06 `L` so they remain separable as four distinct greys. Same treatment for the short-wavelength group (sky 215°, blue 265°, violet 305°, pink 350°) under tritanopia.
- **Assignment order alternates between the two groups** (`sky, red, green, pink, amber, blue, violet, olive`) so that consecutive field runs — which are physically adjacent in the hex dump — never come from the same collapse group.
- **Every one is AA text on `surface-inset`** in its own theme (lowest is 4.6:1), because the palette is used as *ink on bytes*, not only as background tint.
- **Color is never the only signal.** A byte run additionally carries: a 1px left/right run border in the same ink, the field id printed in the ribbon gutter, a bracket glyph at run start/end, and the run's field id in the byte tooltip. Turning the palette off entirely (monochrome mode) must lose zero information.

| # | Hue | Dark ink `L` | Dark ratio on `surface-inset` | Light ink `L` | Light ratio on `surface-inset` |
|---|---|---|---|---|---|
| 1 | sky 215° | 0.89 | 11.5:1 | 0.24 | 9.5:1 |
| 2 | red 30° | 0.73 | 7.3:1 | 0.36 | 6.2:1 |
| 3 | green 150° | 0.80 | 8.9:1 | 0.30 | 7.7:1 |
| 4 | pink 350° | 0.66 | 5.8:1 | 0.42 | 5.0:1 |
| 5 | amber 78° | 0.88 | 11.2:1 | 0.26 | 8.9:1 |
| 6 | blue 265° | 0.73 | 7.3:1 | 0.36 | 6.2:1 |
| 7 | violet 305° | 0.81 | 9.2:1 | 0.30 | 7.7:1 |
| 8 | olive 118° | 0.66 | 5.8:1 | 0.42 | 5.0:1 |

Assignment is **stable per field id within a session** (`hlIndex = fieldIdHashOrder % 8`, computed once per decode from ascending field order, not from render order) so a field does not change color when another field is added or removed.

Reserved hues that the palette avoids: **185–205°** belongs to `accent` alone. A field run must never be mistakable for a selection.

### 1.4 The token file

```css
/* ─────────────────────────────────────────────────────────────
   src/styles/app.css — BufferX design tokens (Tailwind CSS v4)
   ───────────────────────────────────────────────────────────── */
@import "tailwindcss";

/* Typefaces first, so @font-face is registered before anything paints. */
@import "./fonts.css";

/* Manual, attribute-driven theming. `data-theme` is always present on <html>. */
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));
@custom-variant light (&:where([data-theme="light"], [data-theme="light"] *));

/* ── Raw palette: DARK (default) ─────────────────────────────── */
:root,
[data-theme="dark"] {
  color-scheme: dark;

  /* Surfaces — cool charcoal, hue 255, chroma held ≤ 0.012.
     Lifted off near-black: the canvas used to be rgb(12,16,21), which put
     primary text at 17:1 and read as glare rather than clarity. Raising the
     whole ladder keeps every step distinct while taking the harshness out. */
  --bx-surface-0:      oklch(0.196 0.010 255); /* app canvas            */
  --bx-surface-1:      oklch(0.232 0.011 255); /* panel / card          */
  --bx-surface-2:      oklch(0.268 0.011 255); /* control fill, th, bar */
  --bx-surface-3:      oklch(0.298 0.012 255); /* popover, dialog, menu */
  --bx-surface-inset:  oklch(0.172 0.010 255); /* hex viewer, code well */
  --bx-surface-raised: oklch(0.252 0.011 255); /* hover row, chip       */
  --bx-scrim:          oklch(0.12  0.008 255 / 0.62);

  /* Text — primary eased from 0.960 so long sessions are comfortable. Still
     ~13:1 on the canvas, far above the 4.5:1 AA floor. */
  --bx-text-primary:   oklch(0.928 0.004 255);
  --bx-text-secondary: oklch(0.782 0.008 255);
  --bx-text-tertiary:  oklch(0.706 0.010 255);
  --bx-text-disabled:  oklch(0.558 0.010 255);
  --bx-text-inverse:   oklch(0.196 0.012 255);

  /* Borders — lifted with the surfaces so separation is not lost */
  --bx-border-subtle:  oklch(0.306 0.010 255); /* row hairline          */
  --bx-border-default: oklch(0.392 0.012 255); /* panel edge, divider   */
  --bx-border-strong:  oklch(0.576 0.014 255); /* input / control edge  */

  /* Accent — cyan-teal, hue band 185–205 reserved. Chroma nearly halved
     (0.130 → 0.072): the accent marks the focused thing, it should not
     compete with the data for attention. */
  --bx-accent:         oklch(0.800 0.072 195);
  --bx-accent-hover:   oklch(0.856 0.066 195);
  --bx-accent-active:  oklch(0.746 0.074 195);
  --bx-accent-muted:   oklch(0.322 0.034 195); /* selection / soft fill */
  --bx-accent-fg:      oklch(0.196 0.014 210); /* ink on accent fill    */

  /* Status — chroma reduced ~40%. These stay legible and unambiguous, but a
     screen with several warnings no longer looks like a fairground. */
  --bx-ok:             oklch(0.802 0.092 152);
  --bx-ok-bg:          oklch(0.286 0.032 152);
  --bx-ok-border:      oklch(0.458 0.056 152);
  --bx-warn:           oklch(0.826 0.088 78);
  --bx-warn-bg:        oklch(0.292 0.032 78);
  --bx-warn-border:    oklch(0.484 0.060 78);
  --bx-error:          oklch(0.738 0.110 25);
  --bx-error-bg:       oklch(0.288 0.040 25);
  --bx-error-border:   oklch(0.488 0.074 25);
  --bx-info:           oklch(0.786 0.074 250);
  --bx-info-bg:        oklch(0.286 0.032 250);
  --bx-info-border:    oklch(0.470 0.056 250);

  /* Field / byte highlight — ink.
     Chroma comes down but the hue spread is untouched: telling eight field
     runs apart is this palette's entire job. The two darkest entries (4 and 8,
     previously 5.6:1 and 6.3:1) are lightened, so the whole set now sits in a
     narrow band and no field looks more important than another. */
  /* Lightness deliberately varies. With chroma this low, hue alone does not
     separate neighbouring pairs — flat lightness put green(150) and olive(118)
     within 0.053 OKLab of each other, and blue(265) and violet(305) within
     0.066. Staggering lightness restores the separation without putting the
     saturation back, and also keeps the set legible under red-green CVD, where
     hue carries much less information than lightness. */
  --bx-hl-1:  oklch(0.868 0.062 215);
  --bx-hl-2:  oklch(0.796 0.104 30);
  --bx-hl-3:  oklch(0.836 0.096 150);
  --bx-hl-4:  oklch(0.742 0.112 350);
  --bx-hl-5:  oklch(0.878 0.090 78);
  --bx-hl-6:  oklch(0.764 0.096 265);
  --bx-hl-7:  oklch(0.846 0.086 305);
  --bx-hl-8:  oklch(0.712 0.088 118);
  /* Field / byte highlight — run background tint */
  --bx-hl-1-bg: oklch(0.298 0.030 215);
  --bx-hl-2-bg: oklch(0.294 0.036 30);
  --bx-hl-3-bg: oklch(0.294 0.034 150);
  --bx-hl-4-bg: oklch(0.298 0.038 350);
  --bx-hl-5-bg: oklch(0.294 0.032 78);
  --bx-hl-6-bg: oklch(0.302 0.036 265);
  --bx-hl-7-bg: oklch(0.302 0.034 305);
  --bx-hl-8-bg: oklch(0.290 0.030 118);

  /* Shadow ingredients — softened to match the lifted surfaces */
  --bx-shadow-color: oklch(0 0 0 / 0.46);
  --bx-shadow-key:   oklch(0 0 0 / 0.32);
  --bx-rim:          oklch(1 0 0 / 0.045); /* 1px top highlight on raised */
}

/* ── Raw palette: LIGHT (full parity) ────────────────────────── */
[data-theme="light"] {
  color-scheme: light;

  /* Warmed a shade off pure white, for the same reason the dark canvas was
     lifted off pure black: paper, not a lightbulb. */
  --bx-surface-0:      oklch(0.972 0.003 255);
  --bx-surface-1:      oklch(0.998 0.001 255);
  --bx-surface-2:      oklch(0.952 0.004 255);
  --bx-surface-3:      oklch(1.000 0.000 0);
  --bx-surface-inset:  oklch(0.934 0.004 255);
  --bx-surface-raised: oklch(0.962 0.003 255);
  --bx-scrim:          oklch(0.30 0.016 255 / 0.28);

  --bx-text-primary:   oklch(0.248 0.012 255);
  --bx-text-secondary: oklch(0.436 0.012 255);
  --bx-text-tertiary:  oklch(0.470 0.012 255);
  --bx-text-disabled:  oklch(0.596 0.010 255);
  --bx-text-inverse:   oklch(0.992 0.000 0);

  --bx-border-subtle:  oklch(0.908 0.004 255);
  --bx-border-default: oklch(0.862 0.005 255);
  --bx-border-strong:  oklch(0.566 0.012 255);

  --bx-accent:         oklch(0.478 0.070 198);
  --bx-accent-hover:   oklch(0.420 0.066 198);
  --bx-accent-active:  oklch(0.376 0.062 198);
  --bx-accent-muted:   oklch(0.948 0.024 198);
  --bx-accent-fg:      oklch(0.992 0.000 0);

  --bx-ok:             oklch(0.470 0.082 152);
  --bx-ok-bg:          oklch(0.964 0.020 152);
  --bx-ok-border:      oklch(0.842 0.050 152);
  --bx-warn:           oklch(0.470 0.072 66);
  --bx-warn-bg:        oklch(0.964 0.024 70);
  --bx-warn-border:    oklch(0.842 0.056 70);
  --bx-error:          oklch(0.474 0.122 25);
  --bx-error-bg:       oklch(0.964 0.020 25);
  --bx-error-border:   oklch(0.842 0.056 25);
  --bx-info:           oklch(0.474 0.094 252);
  --bx-info-bg:        oklch(0.964 0.020 252);
  --bx-info-border:    oklch(0.842 0.048 252);

  /* Same principle as dark: chroma down, hue spread and legibility kept,
     and the extremes pulled toward the middle so no field shouts. */
  --bx-hl-1:  oklch(0.322 0.076 215);
  --bx-hl-2:  oklch(0.398 0.108 30);
  --bx-hl-3:  oklch(0.352 0.084 150);
  --bx-hl-4:  oklch(0.404 0.118 350);
  --bx-hl-5:  oklch(0.336 0.074 78);
  --bx-hl-6:  oklch(0.392 0.112 265);
  --bx-hl-7:  oklch(0.360 0.106 305);
  --bx-hl-8:  oklch(0.396 0.084 118);
  --bx-hl-1-bg: oklch(0.952 0.024 215);
  --bx-hl-2-bg: oklch(0.956 0.024 30);
  --bx-hl-3-bg: oklch(0.952 0.026 150);
  --bx-hl-4-bg: oklch(0.956 0.024 350);
  --bx-hl-5-bg: oklch(0.956 0.030 78);
  --bx-hl-6-bg: oklch(0.956 0.022 265);
  --bx-hl-7-bg: oklch(0.956 0.022 305);
  --bx-hl-8-bg: oklch(0.952 0.030 118);

  --bx-shadow-color: oklch(0.30 0.016 255 / 0.12);
  --bx-shadow-key:   oklch(0.30 0.016 255 / 0.08);
  --bx-rim:          oklch(1 0 0 / 0.70);
}

/* ── Density: dense (default) ────────────────────────────────── */
:root,
[data-density="dense"] {
  /* Dense still means dense, but the baseline moved 13px → 14px. At 13px the
     app was legible in a screenshot and tiring across a shift; a single pixel
     buys back most of that for one extra row of vertical space per ~14 rows. */
  --bx-row-h:        1.75rem;   /* 28px table row                   */
  --bx-control-h-xs: 1.5rem;    /* 24px inline chip / cell editor   */
  --bx-control-h-sm: 1.75rem;   /* 28px default control             */
  --bx-control-h-md: 2rem;      /* 32px primary action              */
  --bx-control-h-lg: 2.375rem;  /* 38px dialog footer               */
  --bx-cell-px:      0.5625rem; /* 9px  table cell inline padding   */
  --bx-cell-py:      0.1875rem; /* 3px                              */
  --bx-field-gap:    0.4375rem; /* 7px  between related controls    */
  --bx-group-gap:    0.875rem;  /* 14px between control groups      */
  --bx-panel-p:      0.875rem;  /* 14px panel padding               */
  --bx-ui-size:      0.875rem;  /* 14px UI baseline                 */
  --bx-mono-size:    0.875rem;  /* 14px mono baseline               */
}

/* ── Density: comfortable ────────────────────────────────────── */
[data-density="comfortable"] {
  --bx-row-h:        2rem;      /* 32px */
  --bx-control-h-xs: 1.75rem;   /* 28px */
  --bx-control-h-sm: 2rem;      /* 32px */
  --bx-control-h-md: 2.25rem;   /* 36px */
  --bx-control-h-lg: 2.625rem;  /* 42px */
  --bx-cell-px:      0.75rem;   /* 12px */
  --bx-cell-py:      0.3125rem; /* 5px  */
  --bx-field-gap:    0.5rem;    /* 8px  */
  --bx-group-gap:    1rem;      /* 16px */
  --bx-panel-p:      1rem;      /* 16px */
  --bx-ui-size:      0.875rem;  /* 14px */
  --bx-mono-size:    0.875rem;  /* 14px */
}

/* ── Tailwind theme surface ──────────────────────────────────── */
/* `inline` keeps the var() reference in generated utilities so runtime
   theme + density swaps work without regenerating any CSS. */
@theme inline {
  /* Colors */
  --color-surface-0:      var(--bx-surface-0);
  --color-surface-1:      var(--bx-surface-1);
  --color-surface-2:      var(--bx-surface-2);
  --color-surface-3:      var(--bx-surface-3);
  --color-surface-inset:  var(--bx-surface-inset);
  --color-surface-raised: var(--bx-surface-raised);
  --color-scrim:          var(--bx-scrim);

  --color-text:           var(--bx-text-primary);
  --color-text-secondary: var(--bx-text-secondary);
  --color-text-tertiary:  var(--bx-text-tertiary);
  --color-text-disabled:  var(--bx-text-disabled);
  --color-text-inverse:   var(--bx-text-inverse);

  --color-border-subtle:  var(--bx-border-subtle);
  --color-border:         var(--bx-border-default);
  --color-border-strong:  var(--bx-border-strong);

  --color-accent:         var(--bx-accent);
  --color-accent-hover:   var(--bx-accent-hover);
  --color-accent-active:  var(--bx-accent-active);
  --color-accent-muted:   var(--bx-accent-muted);
  --color-accent-fg:      var(--bx-accent-fg);

  --color-ok:             var(--bx-ok);
  --color-ok-bg:          var(--bx-ok-bg);
  --color-ok-border:      var(--bx-ok-border);
  --color-warn:           var(--bx-warn);
  --color-warn-bg:        var(--bx-warn-bg);
  --color-warn-border:    var(--bx-warn-border);
  --color-error:          var(--bx-error);
  --color-error-bg:       var(--bx-error-bg);
  --color-error-border:   var(--bx-error-border);
  --color-info:           var(--bx-info);
  --color-info-bg:        var(--bx-info-bg);
  --color-info-border:    var(--bx-info-border);

  --color-hl-1: var(--bx-hl-1);  --color-hl-1-bg: var(--bx-hl-1-bg);
  --color-hl-2: var(--bx-hl-2);  --color-hl-2-bg: var(--bx-hl-2-bg);
  --color-hl-3: var(--bx-hl-3);  --color-hl-3-bg: var(--bx-hl-3-bg);
  --color-hl-4: var(--bx-hl-4);  --color-hl-4-bg: var(--bx-hl-4-bg);
  --color-hl-5: var(--bx-hl-5);  --color-hl-5-bg: var(--bx-hl-5-bg);
  --color-hl-6: var(--bx-hl-6);  --color-hl-6-bg: var(--bx-hl-6-bg);
  --color-hl-7: var(--bx-hl-7);  --color-hl-7-bg: var(--bx-hl-7-bg);
  --color-hl-8: var(--bx-hl-8);  --color-hl-8-bg: var(--bx-hl-8-bg);

  --color-focus:          var(--bx-accent);
  --color-focus-contrast: var(--bx-surface-0);

  /* Type */
  /* "Vazirmatn Variable" sits in both stacks after the Latin face: the browser
     only reaches it for codepoints the Latin font lacks, so Persian renders
     properly wherever it appears without affecting Latin metrics. */
  --font-sans: "Inter Variable", "Vazirmatn Variable", "Segoe UI Variable Text",
               "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
  --font-mono: "JetBrains Mono Variable", "Vazirmatn Variable", "Cascadia Mono",
               Consolas, "SF Mono", "Roboto Mono", "DejaVu Sans Mono", ui-monospace, monospace;
  /* For Persian-only surfaces (the IranSystem output), where the Latin face
     should not get first refusal on shared punctuation and digits. */
  --font-persian: "Vazirmatn Variable", "Segoe UI", Tahoma, sans-serif;

  /* The whole scale moved up one step. Nothing here was large to begin with —
     a 13px label next to 13px data gives the eye no hierarchy to grab, and the
     smallest rung was 11px, which is below what most people read comfortably
     for a full working day. Weights are also nudged up slightly, because Inter
     at 450 is lighter than the Segoe fallback this used to render in. */
  --text-2xs: 0.75rem;    --text-2xs--line-height: 1.0625rem; --text-2xs--font-weight: 520; --text-2xs--letter-spacing: 0.01em;
  --text-xs:  0.8125rem;  --text-xs--line-height:  1.1875rem; --text-xs--font-weight:  470;
  --text-sm:  0.875rem;   --text-sm--line-height:  1.3125rem; --text-sm--font-weight:  470;
  --text-base:0.9375rem;  --text-base--line-height:1.4375rem; --text-base--font-weight:470;
  --text-md:  1.0625rem;  --text-md--line-height:  1.5625rem; --text-md--font-weight:  510; --text-md--letter-spacing: -0.005em;
  --text-lg:  1.3125rem;  --text-lg--line-height:  1.8125rem; --text-lg--font-weight:  560; --text-lg--letter-spacing: -0.01em;
  --text-xl:  1.5625rem;  --text-xl--line-height:  2.0625rem; --text-xl--font-weight:  610; --text-xl--letter-spacing: -0.015em;

  --text-mono-xs:   0.75rem;   --text-mono-xs--line-height:   1.1875rem;
  --text-mono-sm:   0.8125rem; --text-mono-sm--line-height:   1.3125rem;
  --text-mono-base: 0.875rem;  --text-mono-base--line-height: 1.4375rem;
  --text-mono-lg:   1rem;      --text-mono-lg--line-height:   1.5625rem;

  /* Spacing base — every step is a multiple of 0.25rem (4px) */
  --spacing: 0.25rem;

  /* Radii — tight; this is an instrument, not a consumer app */
  --radius-xs:   2px;
  --radius-sm:   3px;   /* inputs, buttons, chips, cells        */
  --radius-md:   5px;   /* cards, panels, popovers              */
  --radius-lg:   8px;   /* dialogs, command palette             */
  --radius-full: 9999px;/* switch track, status dot, pill only  */

  /* Elevation */
  --shadow-e0: none;
  --shadow-e1: inset 0 1px 0 0 var(--bx-rim),
               0 1px 2px -1px var(--bx-shadow-key);
  --shadow-e2: 0 2px 4px -2px var(--bx-shadow-key),
               0 6px 16px -4px var(--bx-shadow-color);
  --shadow-e3: 0 4px 10px -4px var(--bx-shadow-key),
               0 18px 44px -10px var(--bx-shadow-color);
  --shadow-focus: 0 0 0 1px var(--color-focus-contrast),
                  0 0 0 3px var(--color-focus);

  /* Motion */
  --ease-standard:   cubic-bezier(0.2, 0, 0, 1);
  --ease-decelerate: cubic-bezier(0.05, 0.7, 0.1, 1);
  --ease-accelerate: cubic-bezier(0.3, 0, 0.8, 0.15);
  --ease-emphasis:   cubic-bezier(0.16, 1, 0.3, 1);

  --duration-instant: 80ms;
  --duration-fast:    120ms;
  --duration-base:    180ms;
  --duration-slow:    240ms;
  --duration-slower:  320ms;

  /* Density passthrough (so Tailwind utilities can read them) */
  --spacing-row:     var(--bx-row-h);
  --spacing-cell-x:  var(--bx-cell-px);
  --spacing-cell-y:  var(--bx-cell-py);
  --spacing-field:   var(--bx-field-gap);
  --spacing-group:   var(--bx-group-gap);
  --spacing-panel:   var(--bx-panel-p);

  --height-control-xs: var(--bx-control-h-xs);
  --height-control-sm: var(--bx-control-h-sm);
  --height-control-md: var(--bx-control-h-md);
  --height-control-lg: var(--bx-control-h-lg);
}

/* ── Base ───────────────────────────────────────────────────── */
@layer base {
  html {
    background: var(--color-surface-0);
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: 16px;
    font-optical-sizing: auto;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
    accent-color: var(--color-accent);
  }
  body { font-size: var(--bx-ui-size); line-height: 1.375rem; }

  /* Persian/Arabic surfaces. The IranSystem panel's output is the one place in
     the app where a misread character is a wrong answer, so it gets the face
     that was designed for the script, at a size that accounts for Arabic
     needing more vertical room than Latin at the same nominal size. */
  [dir="rtl"], .font-persian, [data-persian] {
    font-family: var(--font-persian);
    font-size: 1.0625em;
    line-height: 1.9;
  }

  /* Every numeric/mono surface: tabular figures + slashed zero, always.
     `.font-mono` is included because that Tailwind utility -- not the bare
     elements -- is what components reach for; without it, hex dumps and PANs
     lose column alignment and 0/O stop being distinguishable. */
  code, kbd, pre, samp, .mono, .font-mono, [data-mono] {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums slashed-zero;
    font-feature-settings: "zero" 1, "ss01" 1, "calt" 0, "liga" 0;
    font-variant-ligatures: none;
  }
  /* UI type still uses tabular figures for counts, offsets, lengths. */
  .tnum, [data-tnum] { font-variant-numeric: tabular-nums; }

  ::selection { background: var(--color-accent-muted); color: var(--color-text); }

  /* Focus: :focus-visible only, never :focus. */
  :focus { outline: none; }
  :focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 1px;
    border-radius: inherit;
  }
}
```

### 1.5 Theme bootstrap (must run before first paint)

```html
<script>
  (function () {
    var d = document.documentElement;
    var t = localStorage.getItem("bx:theme");
    if (t !== "light" && t !== "dark") {
      t = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    d.dataset.theme = t;                                    /* always present */
    d.dataset.density = localStorage.getItem("bx:density") === "comfortable"
      ? "comfortable" : "dense";
  })();
</script>
```

`bx:theme` and `bx:density` are the **only** two keys BufferX is permitted to write to `localStorage`. No buffer content, no field values, no keys, no PANs, no PINs — ever.

---

## 2. Typography

### 2.1 Stacks

**UI:** `Inter` (variable, `wght 400–700`, self-hosted, `latin` + `latin-ext` subsets, `woff2`, `font-display: swap`). Chosen for a tall x-height at 12–13px, real tabular figures, and a variable axis so 450/550 optical weights are available without a second file. Fallback chain ends in `system-ui`.

**Mono:** `JetBrains Mono Variable` shipped (self-hosted, `woff2-variations`, Latin + Latin Extended subsets) — not IBM Plex Mono as originally specified here. It was chosen over Plex for a taller x-height and more clearly separated `0/O` and `1/l/I`, which is the whole job in a tool full of PANs, keys, and hex. `Vazirmatn Variable` is also shipped, for the IranSystem panel's Persian output — Latin faces have no Arabic-script coverage at all, so without it that panel silently fell back to whatever the OS happened to offer. The selection criteria below were the real ones applied; only the resulting typeface name changed:

1. **Slashed zero by default** — `0` vs `O` must be unambiguous with no OpenType feature required (a feature can silently fail to load; a glyph cannot).
2. **`1` with a base serif and a full flag; `l` with a tail; `I` with top and bottom crossbars** — the `1 l I` triple is the single most dangerous confusion in a PAN or a key.
3. Distinct `5`/`S`, `8`/`B`, `2`/`Z`, `6`/`b`, `9`/`g`.
4. No coding ligatures (disabled explicitly above anyway — `!=` in a TLV dump must render as two bytes).
5. Even, generous letterspacing at 12–13px so a 32-column hex grid does not visually merge.

The shipped fallback chain is `JetBrains Mono Variable`, `Vazirmatn Variable`, `Cascadia Mono`, `Consolas`, `SF Mono`, `Roboto Mono`, `DejaVu Sans Mono`, `ui-monospace`, `monospace` — see `app/src/styles/app.css`'s `--font-mono`. Consolas is present as a real fallback in the shipped stack (it is what Windows had installed on the machine this shipped from), which contradicts the original exclusion below; the guidance to prefer JetBrains Mono / Plex-class faces over Consolas when a choice is available still stands.

**Font QA gate (blocking, in CI as a visual snapshot):** render `0O 1lI 5S 8B 2Z 6b 9g rn m` and `4111 1111 1111 1111` and `0123456789ABCDEF` at 11px, 12px, 13px, 15px in both themes. Every pair must be separable at 100% zoom without leaning in.

### 2.2 Scale

| Token | Size | Line | Weight | Use |
|---|---|---|---|---|
| `text-2xs` | 11px / 0.6875rem | 16px | 500 | Hex gutter offsets, byte-column ruler, badge text, keyboard hints, table sub-labels |
| `text-xs` | 12px / 0.75rem | 18px | 450 | Table cells, secondary metadata, tooltip body, inline help |
| `text-sm` | 13px / 0.8125rem | 20px | 450 | **UI default.** Control labels, button text, menu items, tab labels, field names |
| `text-base` | 14px / 0.875rem | 22px | 450 | Dialog body copy, inline alert body, empty-state body |
| `text-md` | 16px / 1rem | 24px | 500 | Panel and section titles |
| `text-lg` | 20px / 1.25rem | 28px | 550 | Dialog titles, command palette input |
| `text-xl` | 24px / 1.5rem | 32px | 600 | Empty-state headline. Used at most once per screen. |

**Mono scale:**

| Token | Size | Line | Use |
|---|---|---|---|
| `text-mono-xs` | 11px | 18px | Hex offset gutter, byte-index ruler, badge values, table row of 8 chars |
| `text-mono-sm` | 12px | 20px | Dense table mono cells, TLV tree, inline value chips |
| `text-mono-base` | 13px | 22px | **Mono default.** Hex viewer body, buffer editor, key/PEM/base64 inputs, XML editor |
| `text-mono-lg` | 15px | 24px | Single focused value under inspection (PIN block, MAC, KCV), diff pane |

Weights: 400 is never used for UI text below 14px (too thin against a dark surface at 13px); the floor is **450**. Mono uses 400 for body and 500 for emphasis (matched bytes, selected field). **Bold is never used to convey state** — state is color + icon + text.

### 2.3 The mono rule

> **Use monospace whenever column position, character identity, or byte alignment is meaningful. Use UI type for everything a human reads as language.**

| Always mono | Always UI type |
|---|---|
| Hex buffers, byte runs, ASCII pane | Field descriptions ("Primary account number") |
| PAN, track 2, PIN blocks, PINs, offsets, PVV, PVKI | Button labels, menu items, tab labels |
| Keys, KCVs, MACs, IVs, base64, PEM bodies | Panel and section titles |
| Field ids (`F035`), bitmap bits, byte offsets (`0x0040`), lengths (`0128`) | Prose in dialogs, empty states, help text |
| Packager names (`STX21`), MTI (`0200`), response codes (`00`) | Error *sentences* — but the offending value inside them is mono |
| Host, port, elapsed ms, byte counts | Tooltip prose |
| TLV tags, XML, JSON payloads | Settings labels and captions |

A value quoted inside a UI sentence is wrapped in a mono span at the same optical size (mono at 13px reads ~1 step larger than Inter at 13px, so quoted mono inside `text-sm` uses `text-mono-sm`).

---

## 3. Spacing, radii, borders, elevation, density

### 3.1 Spacing

Base unit `--spacing: 0.25rem` (4px). Tailwind derives everything from it, so `p-1.5` = 6px, `p-0.5` = 2px. **Permitted ladder:** `0, 0.5(2), 1(4), 1.5(6), 2(8), 2.5(10), 3(12), 4(16), 5(20), 6(24), 8(32), 10(40), 12(48), 16(64)`. Values outside the ladder require a comment justifying them.

Semantic aliases (density-aware): `gap-field` (6px dense / 8px comfortable) between related controls, `gap-group` (12/16) between groups, `p-panel` (12/16) for panel interiors, `px-cell` / `py-cell` for table cells.

### 3.2 Radii

`2px` chips and inline editors, `3px` inputs/buttons/cells/badges, `5px` cards/panels/popovers/menus, `8px` dialogs and the command palette, `9999px` only for switch tracks, status dots, and true pills. Nested radii subtract 1px from the parent (a `radius-sm` input inside a `radius-md` card is fine; a `radius-md` control inside a `radius-md` card is not).

### 3.3 Borders

1px hairlines everywhere; there is no 2px border in the system except the focus ring. Three weights by color, not by width:

- `border-subtle` — separators *inside* one component (table rows, list items, hex row groups).
- `border` — the edge of a container (panel, card, popover, table outline, split divider).
- `border-strong` — the edge of anything interactive (input, select, checkbox, unpressed secondary button). Guaranteed ≥ 3:1 against both `surface-1` and `surface-2`.

Hairlines are drawn with `border` (not `box-shadow`) so they survive `print` and forced-colors mode. On a table, borders live on the *cell* (`border-b`) not the row, so a virtualized list can recycle rows without seams.

### 3.4 Elevation

Four levels. Elevation is **border + shadow + surface step**, never shadow alone (dark shadows are near-invisible on a dark canvas).

| Level | Surface | Border | Shadow | Used by |
|---|---|---|---|---|
| `e0` | `surface-1` | `border` | none | Cards, panels, docked regions, table containers |
| `e1` | `surface-2` | `border-strong` | `--shadow-e1` | Buttons, inputs, segmented control, chips |
| `e2` | `surface-3` | `border` | `--shadow-e2` | Popovers, dropdown menus, tooltips (tooltip omits the border) |
| `e3` | `surface-3` | `border` | `--shadow-e3` | Dialogs, command palette, toast stack |

The scrim (`--bx-scrim`) is applied only for `e3` modal dialogs, never for popovers.

### 3.5 Density

`data-density="dense"` is the default and is what the app is designed for. `data-density="comfortable"` is a first-class option (touch input, projector demos, accessibility), toggled from Settings and from the command palette (`Toggle density`).

| | dense | comfortable |
|---|---|---|
| Table row | 24px | 32px |
| Control heights (xs/sm/md/lg) | 22 / 26 / 30 / 36 | 28 / 32 / 36 / 42 |
| Cell padding | 8 × 2 | 12 × 5 |
| Field gap / group gap | 6 / 12 | 8 / 16 |
| Panel padding | 12 | 16 |
| UI / mono size | 13 / 13 | 14 / 14 |

Density changes **height and padding only**. It never changes font family, color, radius, border, or information architecture — so a screenshot from one density is a valid bug report against the other. Hex viewer row height is derived from `--text-mono-base--line-height` and is *not* affected by density (byte grid geometry must stay stable); density affects only its chrome.

---

## 4. Components

Notation used in every table: **Default → Hover → Focus-visible → Active/Pressed → Disabled → Invalid → Loading.** Any state not listed for a component does not exist for it.

Universal rules:

- Every interactive element has a **≥ 24×24px pointer target** (WCAG 2.2 §2.5.8) even at 22px visual height — pad with a transparent hit area, do not grow the visual box.
- Every interactive element is reachable by `Tab` in DOM order, and `Escape` always closes the nearest dismissible layer.
- Disabled controls **explain themselves**. A disabled control gets a tooltip stating the precondition (`"Needs a MAC field in the active packager"`). Silent greying is a defect. (This is the direct fix for the Qt PIN panel's invisible PAN-enablement rule.)
- No control ever silently reverts its own value. If an operation is rejected, the old value stays and an inline error appears next to the control.

### 4.1 Button

**Anatomy:** `[leading icon 16] [label] [trailing icon 16 | kbd hint]`, `radius-sm`, `gap-1.5`, inline-flex, centered, `text-sm`, weight 500, `white-space: nowrap`.

**Variants**

| Variant | Fill | Border | Text | Use |
|---|---|---|---|---|
| `primary` | `accent` | none | `accent-fg` | The one committing action per surface (Decode, Build, Send, Save) |
| `secondary` | `surface-2` | `border-strong` | `text` | Everything else |
| `ghost` | transparent | none | `text-secondary` | Toolbar, table row actions, icon-only |
| `outline` | transparent | `border-strong` | `text` | Alternate action in a dialog footer |
| `danger` | `error-bg` | `error-border` | `error` | Clear fields, Delete buffer, Reset — always paired with confirm |
| `link` | none | none | `accent`, underline on hover | Inline navigation only |

**Sizes:** `xs` = `h-control-xs` px-1.5 `text-xs`; `sm` = `h-control-sm` px-2.5 `text-sm` (**default**); `md` = `h-control-md` px-3 `text-sm`; `lg` = `h-control-lg` px-4 `text-base`. Icon-only buttons are square at the same height and **require** `aria-label` + tooltip.

**States**

| State | Treatment |
|---|---|
| Hover | `primary` → `accent-hover`; others → surface steps up one level (`surface-2`→`surface-raised`), border unchanged. 120ms. |
| Focus-visible | `--shadow-focus` (1px contrast halo + 3px accent ring), outline-offset 1px. Ring is drawn *outside* so it never shifts layout. |
| Active | Surface steps down (`accent-active`), `transform: none` — no press-scale; a 1px translate on a dense toolbar reads as jitter. |
| Disabled | `opacity: .5`, `cursor: not-allowed`, `aria-disabled="true"`, no hover, still focusable, tooltip states the precondition. Never `pointer-events: none` (it kills the tooltip). |
| Invalid | Buttons are not invalid. The control they submit is. |
| Loading | Label stays, leading icon swaps to a 14px indeterminate spinner (1.5px stroke, 900ms linear), width is **locked** to the pre-loading measurement, `aria-busy="true"`, `aria-disabled="true"`. Operations > 400ms only. Cancellable operations (TCP send) swap the button to `Cancel` after 1s instead of spinning forever. |

### 4.2 Input (single line, UI type)

**Anatomy:** `[label (text-xs, text-secondary, 4px below)] [prefix slot] [field] [suffix slot / unit / action] [help or error (text-xs)]`. Height `h-control-sm`, `px-2`, `radius-sm`, `bg surface-2`, `border-strong`, `text-sm`.

| State | Treatment |
|---|---|
| Default | `bg surface-2`, `border-strong`, placeholder `text-tertiary` (never italic) |
| Hover | `border` lightens one step; background unchanged |
| Focus-visible | `border-color: accent` + `--shadow-focus`; background steps to `surface-3` in dark / stays in light |
| Active/typing | Identical to focus. Caret is `accent`, 2px wide. |
| Disabled | `bg surface-1`, `text-disabled`, `border-subtle`, tooltip explains why |
| Read-only | `bg surface-1`, `border` (not `strong`), text at full `text` color, selectable, with a copy button in the suffix. Visually distinct from disabled — read-only results (calculated MAC, translated PIN block) are *valuable*, not inert. |
| Invalid | `border-color: error`, a 14px `alert-triangle` in the suffix, `aria-invalid="true"`, `aria-describedby` → the error node. **Error text renders inline beneath the field, never in a status bar.** |
| Warning | `border-color: warn` + suffix icon. Used for "leading/trailing space in value" and "non-ASCII in text mode" — advisory, not blocking. |
| Loading | Suffix shows a 12px spinner; field stays editable unless the value is being replaced. |

Unit and count affordances live in the suffix as `text-2xs text-tertiary` (`ms`, `bytes`, `12/19`). **Every numeric input states its unit.** (Direct fix for the Qt network panel's three unlabelled spin boxes.)

### 4.3 Textarea

As Input, plus: `min-height` 3 rows, `resize: vertical` with a visible 12px grip, `field-sizing: content` capped at `max-height: 40vh`, line-height 20px. **A textarea never has a hard pixel cap that fights the window** — the ISO buffer editor is a flex child with `min-h-0` and grows with the pane. Character/byte count in the bottom-right corner as `text-2xs text-tertiary`, mono.

### 4.4 Mono / hex input

The workhorse. Used for hex buffers, keys, PANs, MACs, base64.

- Font `--font-mono`, `text-mono-base`, `tabular-nums slashed-zero`, ligatures off.
- `spellcheck="false"`, `autocomplete="off"`, `autocapitalize="off"`, `autocorrect="off"`, `inputMode` set per content (`numeric` for PAN, `text` for hex).
- **Grouping:** hex renders in space-separated pairs (`4F 12 A0 …`), PAN in groups of 4, base64 unbroken. Grouping is *presentational* — the model value never contains the separators, and paste strips them.
- **Live validation:** invalid characters are rejected at input time with a 1-frame `border-color: error` flash (no layout shift, no toast) and the character is not inserted. Odd-length hex is flagged as a warning (not an error) with `n bytes + 1 nibble` in the suffix.
- **Byte counter** in the suffix, always: `48 bytes`. For fixed-length values (key = 8/16/24 bytes) the counter turns `ok` when it hits a legal length and `warn` otherwise, with the legal set in the tooltip. This is the pre-flight length check the Qt Crypto panel lacked.
- Multi-line variants use CodeMirror 6 with the same tokens: `--color-surface-inset` background, hex-pair highlighting, a byte-offset gutter, and matching selection color.

### 4.5 Select (native-backed) and Combobox (searchable)

**Select** — Radix `Select`. Trigger is an Input-shaped box with a 14px `chevron-down` (an actual chevron; the Qt build shipped an outlined square). Content is `e2`, max-height `min(60vh, 24rem)`, scroll with sticky group headers, checkmark on the selected item, 8px item padding, `text-sm`. Type-ahead jumps. Value renders in mono if the value is a code (`STX21`).

**Combobox** — used any time the option count can exceed **8**, which in BufferX means: packager (30+), banking operation (21), field id (128), tag dictionary, saved endpoints.

- Anatomy: trigger → popover with a filter input pinned at top, a virtualized list, group headers, an empty result row, and a footer hint (`↑↓ navigate · ↵ select · esc close`).
- Each option shows **code (mono) + description (UI, `text-tertiary`)** on one 24px row. The packager XML already carries `Desc`; it must be displayed.
- Filter is a substring + subsequence match over code *and* description, case-insensitive, with matched ranges bolded (weight 550, not colored).
- Recents group pinned at top (max 5). Never contains secret values.
- States match Input. `Loading` shows 6 skeleton rows, not a spinner.

### 4.6 Checkbox

14px box (16px at comfortable), `radius-xs`, `border-strong`, `bg surface-2`. Checked → `bg accent`, `border accent`, 10px check stroke in `accent-fg`, 1.75px, drawn with a 120ms `stroke-dashoffset` (skipped under reduced motion). Indeterminate → 8×1.75px bar. Label is `text-sm`, clickable, 8px gap, `align-items: start` for wrapping labels. Focus ring surrounds the box only. Disabled → 50% opacity + precondition tooltip.

### 4.7 Switch

Track 28×16 (`radius-full`), thumb 12px with `--shadow-e1`. Off: track `surface-raised`, border `border-strong`. On: track `accent`, thumb `accent-fg`. Transition 120ms `--ease-standard` on `translate` + `background-color`.

**Use rule:** a Switch means *"this takes effect immediately and changes system behavior."* A Checkbox means *"this is a value that will be submitted."* Therefore `Legacy ATM Engine` is a **Switch** (it rewrites framing on the spot and must also surface a persistent badge in the header — see 4.14), while `Include length header on build` is a **Checkbox**.

### 4.8 Radio

12px circle, 5px `accent` dot when selected. Only for ≤ 5 mutually exclusive options that must all be visible (PIN block format, framing mode). Above 5, use Select. Group is a `role="radiogroup"` with a legend; arrow keys move selection, `Tab` enters/exits the group.

### 4.9 Segmented control

Horizontal group of 2–4 items inside a `surface-2` track with `border-strong`, `radius-sm`, 2px inner padding. Selected item: `bg surface-3` in dark / `bg surface-1` in light, `--shadow-e1`, `text` color, weight 500. Unselected: `text-tertiary`. The selection indicator slides 120ms (reduced motion: cross-fades). Height `h-control-sm`, items `px-2.5`, `text-xs`.

Used for binary/ternary view toggles where both options must be legible at once: `Hex | Text`, `Tree | Flat | Raw`, `Encode | Decode`. **Never** for more than 4, never for values with long labels.

### 4.10 Tabs

Underline style. Tab list sits on `surface-1` with a `border-subtle` bottom rule; the active tab has a 2px `accent` bottom border inset to the label width, `text` color, weight 500. Inactive `text-tertiary`, hover `text-secondary`. Height 32px dense / 36px comfortable, `px-3`, `text-sm`. Overflow scrolls horizontally with fade masks — tabs never wrap and never shrink below their label. Closeable tabs get a 14px `x` that appears on hover/focus and is always present on the active tab; a **dirty tab shows a 6px `accent` dot in place of the `x` until hover**.

Keyboard: `←/→` moves focus, `Home/End`, `Enter/Space` activates (manual activation — auto-activation would trigger a decode on arrow-through). `Ctrl+W` closes, `Ctrl+Tab` cycles.

### 4.11 Table

The most important component in the app. It replaces the Qt 2-column `GridView`.

**Anatomy:** container (`e0`) → sticky toolbar (filter input, column visibility, density toggle, row count) → sticky `thead` → virtualized `tbody` → sticky footer (aggregate/selection count).

**Geometry:** row height = `--bx-row-h` **fixed** (24px dense). Cells `px-cell py-cell`, `border-b border-subtle` on the cell. No zebra striping by default — hairlines at 24px rows are cleaner and stripes fight the field-highlight colors. Optional zebra (`data-zebra`) mixes `surface-1` with 3% `surface-raised`.

**Columns:** resizable by drag on the header edge (8px hit area, `col-resize` cursor, live 1px `accent` guideline), double-click auto-fits to content, widths persisted per table id. **No column is a hardcoded pixel width.** The value column is `flex: 1` with `min-width: 12ch` — a track-2 or an EMV F55 must be readable, and the row expands to a 3-line wrap on `Shift+Enter` or via the row's expand chevron.

**Sorting:** click header toggles asc → desc → none. Indicator is a 12px chevron in `text-tertiary`, `accent` when active, plus `aria-sort`. Multi-sort with `Shift+click`, showing a superscript ordinal. Sorting **never** re-runs a backend call.

**Inline editing:** the cell *is* the editor — `Enter` or typing opens it in place at `h-control-xs` with a 1px inset `accent` ring and no size change. `Enter` commits and moves down, `Tab` commits and moves right, `Escape` reverts, blur commits. An edited-but-uncommitted row shows a 2px `warn` left stripe. **Committing a cell never triggers a rebuild of the whole buffer** — encode is an explicit action.

**Selection:** row click selects, `Shift+click` ranges, `Ctrl/Cmd+click` toggles, `Ctrl+A` selects all filtered rows. Selected row: `bg accent-muted`, 2px `accent` left stripe. Focused row (keyboard cursor, distinct from selection): 1px inset `accent` ring.

**Virtualization contract:** fixed row height, `overscan: 8`, `content-visibility: auto` on off-screen groups, absolutely-positioned rows in a spacer, `role="grid"` with `aria-rowcount`/`aria-rowindex` reflecting the *full* set, not the window. **Rows never animate** — no enter/exit transition, no height transition, no reorder animation. Scrolling 128 fields must be frame-perfect.

**States:** `loading` → 10 skeleton rows matching column widths. `empty` → empty state inside the tbody area (§4.24). `error` → inline alert replacing tbody with a `Retry` action. `filtered-empty` → distinct copy: "No fields match `55`." + `Clear filter`.

### 4.12 Tree

For TLV/EMV structure and packager field hierarchies. Rows are 24px, identical geometry to Table (so a TLV tree and a field table align when stacked).

Anatomy per node: `[indent guides] [chevron 12px | 12px spacer] [type glyph 14px] [tag (mono)] [name (UI, text-tertiary)] [length badge] [value preview (mono, truncated with a middle ellipsis)] [row actions on hover]`.

- Indent 16px per level with 1px `border-subtle` vertical guides; the guide of the ancestor chain of the focused node is drawn in `border-strong`.
- Constructed nodes have a chevron and a `hl-*` accent matching their field's run color; primitive nodes show a type glyph.
- Keyboard: `←` collapse / move to parent, `→` expand / move to first child, `↑↓` move, `Enter` edit value in place, `*` expand all siblings, `Ctrl+C` copies the node's TLV hex.
- Expansion is not animated below 200 visible nodes and is never animated above it.
- `role="tree"`, `aria-expanded`, `aria-level`, `aria-setsize`, `aria-posinset`.

### 4.13 Code / hex viewer

CodeMirror 6, `surface-inset`, `text-mono-base`.

**Hex mode layout (16 bytes/row, split 8|8):**

```
 OFFSET   00 01 02 03 04 05 06 07   08 09 0A 0B 0C 0D 0E 0F   ASCII             FIELD
00000000  30 32 30 30 F2 3C 44 91  28 E0 90 00 00 00 00 04   0200.<D.(.......  ┌ MTI
00000010  31 36 34 32 34 32 34 32  34 32 34 32 34 32 34 32   1642424242424242  │ F002 PAN
```

- **Offset gutter** — `text-mono-xs`, `text-tertiary`, 8 hex digits, `border-r border-subtle`, sticky on horizontal scroll. Click an offset to select the row; `Ctrl+G` jumps to an offset or a field id.
- **Column ruler** — sticky header showing `00…0F`, `text-2xs`, highlighting the current byte's column.
- **Byte cells** — fixed `2ch` + `0.5ch` gap; a 4px extra gap between the two 8-byte groups. Hover raises the byte to `text` and shows a crosshair on its row + column. Current byte: 1px inset `accent` ring plus offset/decimal/binary readout in the status region.
- **Field runs** — background `--color-hl-N-bg`, ink `--color-hl-N`, 1px left/right border in the ink at run boundaries, and the field id in the FIELD ribbon at the right. Hovering a table row highlights its run and scrolls it into view; hovering a run highlights the table row. **This two-way link is the core diagnostic feature and is not optional.**
- **ASCII pane** — same palette, non-printables as `·` in `text-tertiary`; IranSystem/ANSI decoding is a per-pane toggle, and the active decoding is labelled in the pane header (no silent transform).
- **Bitmap view** — a separate mode rendering the primary/secondary bitmap as 128 numbered bit cells, present bits filled with the field's `hl-*` color, absent bits `border-subtle`. Clicking a bit selects the field.
- **Diff mode** — two panes, byte-level, `ok-bg` added / `error-bg` removed / `warn-bg` changed, with a change-count ruler in the scrollbar.
- **Selection** — `accent-muted` background; the selection readout (`byte 0x0010–0x001F · 16 bytes`) is always visible in the pane footer, mono. Copy offers `hex`, `hex + spaces`, `C array`, `base64`, `ASCII` via `Ctrl+Shift+C`.
- Read-only viewers keep full selection, copy, search (`Ctrl+F`), and `Ctrl+G` — read-only is never a downgrade of capability.

### 4.14 Badge / pill

Height 16px (dense) / 18px, `px-1.5`, `radius-sm` (`radius-full` only for count pills), `text-2xs`, weight 500, mono when the content is a code.

| Tone | Fill | Border | Text |
|---|---|---|---|
| `neutral` | `surface-raised` | `border-subtle` | `text-secondary` |
| `accent` | `accent-muted` | `accent` @ 40% | `accent` |
| `ok` / `warn` / `error` / `info` | `*-bg` | `*-border` | `*` |
| `field` | `hl-N-bg` | `hl-N` @ 45% | `hl-N` |

`field` badges carry the id as `F002`, always mono, always the same color as the byte run. Status badges always pair a 8px dot or 12px glyph with the word — never a bare colored dot. A **`LEGACY ENGINE` badge in `warn` tone is pinned in the app header whenever legacy mode is on**, because that mode silently rewrites framing.

### 4.15 Tooltip

Radix `Tooltip`. `surface-3`, `border`, `radius-sm`, `--shadow-e2`, `px-2 py-1`, `text-xs`, `max-width: 22rem`, 6px offset, arrow omitted (an 8px arrow on a 24px row is noise). Delay 400ms in, 100ms out, 0ms when moving between tooltips in the same group. Never contains interactive content, never contains the only copy of information, never shows a secret value. Keyboard focus opens it at the same delay. Long-form content goes in a Popover, not a Tooltip.

### 4.16 Popover

Radix `Popover`. `surface-3`, `border`, `radius-md`, `--shadow-e2`, `p-panel`, `min-width: 18rem`, `max-width: min(92vw, 34rem)`, `max-height: min(70vh, 34rem)` with **internal scroll** and sticky header/footer. Collision-aware (`collisionPadding: 12`), flips and shifts. Focus is trapped while open; `Escape` and outside-click close and restore focus to the trigger.

**Popovers hold at most one task.** Multi-task tool surfaces (PIN, MAC, TLV) are docked panels or dialogs, not popovers — the Qt build's ten mutually-exclusive fixed-pixel popovers are the anti-pattern this replaces. Panels dock into a right rail or float as non-modal windows, and **more than one may be open at a time.**

### 4.17 Dialog

Radix `Dialog`. `surface-3`, `border`, `radius-lg`, `--shadow-e3`, scrim `--bx-scrim` with 120ms fade. Sizes: `sm` 22rem, `md` 32rem (default), `lg` 46rem, `full` `min(92vw, 76rem) × min(88vh, 52rem)`.

Anatomy: header (`text-lg` title + optional `text-xs text-tertiary` subtitle + close `x`) / `border-b` / body (`p-4`, scrollable, `text-base`) / `border-t` / footer (right-aligned: `[Cancel] [Primary]`, `gap-2`).

- Initial focus lands on the **first input**, or the least destructive button when there is no input. Never on a destructive button.
- `Escape` and the close button always work, unless a submit is in flight (then the primary shows `loading` and `Escape` cancels the request).
- **Confirmation dialogs must state the consequence and the exact scope**, e.g. *"Discard 12 edited fields and reload `test-0200.bxb`?"*. A confirm whose body could be written without knowing the data is a bad confirm.
- The two encode-recovery dialogs (binary length mismatch, non-numeric value) **must list the offending fields with their current value, expected length/type, and the exact proposed result**, with a per-field checkbox. "Yes/No blind" is not shippable.

### 4.18 Toast

Bottom-right stack, `max 3` visible, `surface-3`, `border-l-2` in the tone color, `radius-md`, `--shadow-e3`, `w-[22rem]`, `p-3`. Enter: 180ms slide 8px + fade (`--ease-decelerate`). Exit: 120ms fade only.

- `ok` auto-dismisses at 4s. `info` at 6s. **`warn` and `error` never auto-dismiss.**
- Every toast has a close `x` and, where an action exists, exactly one action link (`Undo`, `View details`, `Copy error`).
- Hovering or focusing the stack pauses all timers.
- `role="status"` for ok/info, `role="alert"` for warn/error.
- **Toasts never carry the primary error channel** — validation errors live inline on the control; operation errors live in the panel's result region. A toast is only for something that finished off-screen.
- Toast bodies never contain a key, PIN, PAN, or PEM. They may contain a KCV.

### 4.19 Inline alert

Block-level, `radius-sm`, `p-2.5`, `border`, tone background `*-bg`, tone border `*-border`, 16px tone icon top-left, `text-base` title (weight 500) + `text-sm` body in `text-secondary`, optional action row.

**This is the app's primary error surface.** It replaces the single elided status-bar label entirely. Every panel has a dedicated result/alert region reserved in layout so appearing errors do not shift content. Alerts are dismissible when advisory, persistent when blocking, and they include: what failed, why, the offending value or offset in mono, and the corrective action as a button. Multiple concurrent errors stack — errors are a list, never a single global slot.

### 4.20 Command palette

`Ctrl/Cmd+K`. Modal at `e3`, `w-[40rem] max-w-[92vw]`, anchored at `12vh` from the top, `radius-lg`.

Anatomy: search input (`text-lg`, mono if the query looks like hex or an offset) / `border-b` / virtualized grouped results (`Actions`, `Fields`, `Packagers`, `Buffers`, `Navigate`, `Settings`) / footer (`↑↓` · `↵ run` · `⌘K` close).

- Every result row: 28px, `[icon 16] [label] [context, text-tertiary] [shortcut kbd, right]`.
- Fuzzy subsequence match with matched-range emphasis (weight 550).
- Prefix modes: `>` actions only, `#` field id, `@` packager, `:` byte offset, `/` search the buffer.
- Recents (max 8, session-scoped) at the top of an empty query. **Recents store command ids, never argument values** — a PIN or key typed into a palette-driven action is never recalled.
- Every command in the palette also renders its keyboard shortcut, and the palette is the canonical discovery surface for the shortcut map.

### 4.21 Split pane

1px `border` divider with an 8px transparent hit area and `col-resize`/`row-resize` cursor. Hover: divider becomes `border-strong`. Drag: divider becomes 1px `accent` with a live 1px accent guideline; content does not re-render during drag (commit on pointerup, unless the pane opts into live layout). Double-click resets to the default ratio. Keyboard: focusable (`role="separator"`, `aria-valuenow`), arrows move 16px, `Shift+arrow` 64px, `Home/End` snap to min/max. Panes declare `min-size` in px or `ch`; the divider hard-stops there. Ratios persist per layout id.

### 4.22 Empty state

Centered, `max-width: 26rem`, `py-10`. Anatomy: 24px line icon in `text-tertiary` / `text-xl` headline (weight 600) / `text-base text-secondary` one- or two-sentence body naming what goes here and how it gets here / primary action button / `text-xs text-tertiary` shortcut hint.

Variants: `empty` (nothing yet), `no-results` (filter matched nothing — offers `Clear filter` and echoes the query in mono), `error` (tone `error`, offers `Retry` and `Copy details`), `unsupported` (a host-only capability in the web build — states the limitation plainly and links to the desktop build).

### 4.23 Skeleton

`bg surface-raised`, `radius-xs`, height matched to the real content's line box (never a generic bar). A 1200ms shimmer sweeps at 8% `text-primary` opacity; **under reduced motion the shimmer is replaced by a static 60%-opacity block.** Skeletons appear only after a 200ms delay (faster responses render nothing) and are used only where the final layout is known — otherwise use a centered spinner in the region. Never skeleton the hex viewer; show its gutter and an empty grid.

### 4.24 Copy button

24×24 ghost icon button, `copy` glyph 14px, appears on hover/focus of its container and is **always present in the tab order** (hover-only affordances are keyboard-invisible).

On click: glyph swaps to `check` in `ok` for 1200ms, `aria-live="polite"` announces `"Copied 48 bytes"`, no toast. Failure → glyph swaps to `alert-triangle` in `error` and an inline alert appears.

A copy button exists on: raw buffer, every field value, hex selection, MAC result, KCV, translated PIN block, PVV, offset, TLV encoded hex, IranSystem hex, network response body and wire hex, and the diagnostics blob. **A copy button never exists on a secret input** (see 4.25); secrets expose `Copy KCV` instead.

Long-press / dropdown variant offers format choice (`Hex`, `Hex + spaces`, `Base64`, `ASCII`, `C array`).

### 4.25 Key / secret input (reveal toggle)

The banking-specific control. Used for: MAC key, PIN key, PVK, AES key, ZMK/ZPK, DES/3DES translate keys, private key PEM, and clear PIN.

**Anatomy:** `[label] [field, masked] [KCV chip] [reveal toggle] [clear x] [help: accepted lengths]`.

- Rendered with `--font-mono` **even while masked**, mask glyph `•` at 1ch, so the visible length is the true length.
- `type="password"` semantics via `autocomplete="off" data-sensitive="true" spellcheck="false" name="" `; the field has **no `name`** so nothing can serialize it into a form or a query string.
- **Reveal** is a 24px `eye` toggle. Revealed state: `border-color: warn`, a `warn` `REVEALED` badge on the label row, and a **15-second auto-relock** with the remaining seconds in the badge. Reveal is also relocked immediately on window blur, panel close, route change, and Tauri window minimize.
- **No copy button.** Instead a `KCV` chip shows the key check value (first 3 bytes of the key encrypting a zero block) as mono `text-2xs`; the KCV *is* copyable. This lets an operator verify they pasted the right key without ever rendering or clipboarding the key itself.
- **Length validation is live and pre-flight:** the suffix shows `16 / {8,16,24} bytes`, `ok` tone when legal, `warn` otherwise, with the algorithm's legal set in the help line. No operation is dispatched with an illegal key length.
- **Parity check** for DES keys: an inline `warn` advisory `"Key has even parity on bytes 3, 7"` with an `Adjust parity` action.
- `data-sensitive="true"` is the contract honoured by the logger, the error serializer, telemetry, the crash reporter, and the command palette recents — all of which must redact any value from an element or state slice carrying it. **This is a test-enforced invariant, not a convention.**
- Values are held only in component state, cleared on unmount, never written to `localStorage`/`sessionStorage`/IndexedDB, never placed in a URL, hash, or query string, never included in a saved `.bxb` buffer file, and never sent to the WASM/IPC layer except as an argument to the operation that needs them.

---

## 5. Motion

### 5.1 Durations and easings

| Token | ms | Applies to |
|---|---|---|
| `--duration-instant` | 80 | Hover/active color changes, focus ring, checkbox check |
| `--duration-fast` | 120 | Tooltips, segmented indicator, switch thumb, toast exit, popover close |
| `--duration-base` | 180 | Popover/menu open, toast enter, drawer, tab indicator |
| `--duration-slow` | 240 | Dialog enter, split-pane reset |
| `--duration-slower` | 320 | Command palette enter, first-run panel reveal |

| Easing | Curve | Use |
|---|---|---|
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Default for anything that starts and ends on screen |
| `--ease-decelerate` | `cubic-bezier(0.05, 0.7, 0.1, 1)` | Entering the screen |
| `--ease-accelerate` | `cubic-bezier(0.3, 0, 0.8, 0.15)` | Leaving the screen |
| `--ease-emphasis` | `cubic-bezier(0.16, 1, 0.3, 1)` | Command palette, dialog — the only "expressive" curve, used twice |

Exit is always faster than enter (dismissal must feel instant). Nothing exceeds 320ms. There is no spring physics and no bounce anywhere.

### 5.2 What animates

Only `opacity`, `transform`, `background-color`, `border-color`, `color`, `box-shadow`, `stroke-dashoffset`. Anything animating `width`, `height`, `top/left`, or `margin` is a defect — it forces layout on a 128-row virtualized grid.

### 5.3 What must never animate

- **Byte and field values.** A hex cell never fades, slides, counts up, or flashes on change. If the underlying value changed, that is shown with a persistent `warn` marker, not a transient effect.
- **Table rows and tree nodes** — no enter/exit, no reorder, no height transition, no stagger.
- **The hex viewer grid** — no scroll smoothing, no row transitions. `Ctrl+G` jumps instantly.
- **Layout on data arrival.** Result regions reserve their space; an error appearing must not push the button the operator is about to click.
- **Anything during drag** (split pane, column resize) beyond the 1px guideline.
- **The app's first paint.** The Qt build's 650ms whole-window intro animation is removed; a tool that takes 650ms to become usable is a tool that is 650ms late.

### 5.4 Reduced motion

```css
@media (prefers-reduced-motion: reduce) {
  :root {
    --duration-instant: 1ms;
    --duration-fast:    1ms;
    --duration-base:    1ms;
    --duration-slow:    1ms;
    --duration-slower:  1ms;
  }
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
  /* Keep the affordances that carry meaning, as static states. */
  .bx-skeleton { animation: none; opacity: .6; }
  .bx-spinner  { animation: none; }            /* becomes a static ring + aria-busy */
}
```

Under reduced motion: transforms are dropped entirely (no slide), opacity changes are kept but instant, the segmented/tab indicator jumps rather than slides, indeterminate spinners become a static ring plus a text label (`Sending…`), and the skeleton shimmer becomes a flat block. **No information is lost** — every animated cue has a static equivalent.

---

## 6. Iconography and focus

### 6.1 Icons

- **Library:** Lucide, tree-shaken, imported per-icon. No icon fonts, no sprite CDN.
- **Grid:** 16px default, 14px inside `xs` controls and table rows, 20px in empty states and dialog headers, 24px only in empty-state illustrations. Never scaled to a non-grid size.
- **Stroke:** 1.5px at 16px and above; 1.25px at 14px. Never filled except for status dots and the checkbox check.
- **Color:** `currentColor`, always. An icon inherits its parent's text token. There are no colored icons except status icons, which take the status ink token.
- **Semantics:** `aria-hidden="true"` when paired with a visible label; `role="img"` + `aria-label` when the icon is the only content. An icon-only button always has both `aria-label` and a Tooltip with identical text.
- **Meaning is never carried by an icon alone** in a state context — status is icon + word + color.
- **Domain glyphs** BufferX must draw itself, on the same 16px grid at 1.5px stroke, matching Lucide's terminals and joins: `bitmap` (4×4 grid, half filled), `byte-run` (bracket spanning three cells), `mac` (shield + waveform), `pin-block` (keypad), `tlv-node` (nested brackets), `packager` (layered plates), `length-header` (ruler with a leading tick), `iran-system` (RTL glyph pair). These live in `src/icons/domain/` as React components with a shared `<BxIcon>` wrapper.
- **Never** use emoji, in the UI or in any string.

### 6.2 Focus ring

One ring, everywhere, no exceptions.

```css
@layer components {
  /* Standard ring — for controls with room around them. */
  .bx-focus {
    outline: 2px solid var(--color-focus);
    outline-offset: 1px;
  }
  /* Halo ring — for controls sitting flush against another surface,
     e.g. a segmented item or a toolbar button. The 1px contrast layer
     guarantees the ring is visible against BOTH the control and the
     surface behind it. */
  .bx-focus-halo {
    outline: 2px solid transparent;   /* forced-colors fallback */
    box-shadow: var(--shadow-focus);
  }
  /* Inset ring — for cells, rows, and hex bytes where an outer ring
     would overlap a neighbour. */
  .bx-focus-inset {
    outline: none;
    box-shadow: inset 0 0 0 1px var(--color-focus-contrast),
                inset 0 0 0 2px var(--color-focus);
  }
  @media (forced-colors: active) {
    .bx-focus, .bx-focus-halo, .bx-focus-inset {
      outline: 2px solid Highlight !important;
      outline-offset: 1px;
      box-shadow: none;
    }
  }
}
```

Rules:

1. **`:focus-visible` only.** A mouse click never paints a ring. Keyboard, `Tab`, and programmatic focus always do.
2. The ring is `accent` in both themes and clears 3:1 against every surface it can appear on (dark 7.1:1 on `surface-1`; light 5.5:1 on `surface-1`, 4.6:1 on `surface-inset`).
3. The ring never changes layout. It is drawn with `outline` or `box-shadow`, never with `border`.
4. Focus is never removed by a component's own styles. `outline: none` without a replacement ring is a lint error (`@typescript-eslint` + a stylelint rule).
5. Focus is **always restored** when a layer closes — popover, dialog, palette, and toast all return focus to their trigger.
6. Every focusable element must be visible when focused: `scroll-margin: 8px` on rows and cells, and virtualized lists must scroll the focused row into view before painting the ring.
7. A visible skip link (`Skip to buffer`, `Skip to fields`) is the first tab stop.

---

## 7. Voice

The reader is a payments engineer at 02:00 debugging a live host. They know what a bitmap is. They do not need reassurance, and they do not have time for a paragraph.

**Rules**

1. **Say the specific thing.** Never "An error occurred", "Invalid input", "Something went wrong". Name the object, the constraint, and the offending value.
2. **Structure errors as `<what failed>: <why> (<where>)`.** The `<where>` is a byte offset, a field id, or a character position, in mono. Example: **`Decode failed: length header says 0296 bytes, buffer holds 288 (offset 0x0000)`**.
3. **Every error carries the fix as an action, not as advice.** Not "Try switching to Hex mode." — a `Switch to hex` button.
4. **Second person, imperative, active voice.** "Paste a buffer", not "A buffer should be pasted".
5. **No apologies, no exclamation marks, no "please", no "oops", no emoji, no exhortation.** "Sorry, we couldn't reach the host" → **`Connection refused by 10.20.4.8:5000 after 12 ms`**.
6. **Sentence case everywhere.** Labels and buttons included. `Add length header`, not `Add Length Header`.
7. **Buttons are verbs describing the outcome.** `Decode`, `Build`, `Send`, `Apply to F052`, `Discard edits`. Never `OK`, never `Submit`, never `Yes`/`No` on a consequential dialog — the buttons are `Discard 12 edits` / `Keep editing`.
8. **Units and radix are always stated.** `5000 ms`, `288 bytes`, `0x0040`, `F052`. Never a bare number where a unit exists.
9. **Domain vocabulary is used exactly.** *field*, *bitmap*, *packager*, *length header*, *MAC*, *PIN block*, *KCV*, *TLV*, *nibble*. Do not soften ("data block") and do not invent synonyms. One term per concept across the whole app.
10. **Empty states name the input and the next action.** "No fields decoded. Paste a buffer above and press `Ctrl+Enter`, or open a saved buffer with `Ctrl+O`." Not "Nothing here yet."
11. **Destructive confirmations state the count and the name.** "Discard 12 edited fields and load `hypercom-0800.bxb`?" — a confirm you could write without reading the state is not a confirm.
12. **Secrets are never echoed, ever.** Not in an error, a toast, a log line, a tooltip, or a diagnostics blob. Refer to a key by its KCV: **`MAC verify failed: key KCV 4A2F19 produced 8B03C1, message carries 8B03C0`**.
13. **Loading copy names the operation and the target.** `Sending 288 bytes to 10.20.4.8:5000…`, not `Loading…`.
14. **Help text states the constraint, not the concept.** `8, 16, or 24 bytes hex` beats `Enter the encryption key.`

**Rewrites of the existing strings (normative):**

| Qt string | BufferX string |
|---|---|
| `Invalid hex input.` | `Not valid hex: unexpected 'G' at position 14.` + `Remove invalid characters` |
| `Field id must be numeric.` | `Field id must be a number between 0 and 128. Got 'A5'.` (shown **in** the dialog, before it closes) |
| `Text mode does not support non-ASCII characters. Switch to Hex.` | `Byte 0xF2 at offset 0x0004 has no text representation.` + `Switch to hex` |
| `Length header already present.` | `Header already matches: 4-byte ASCII header reads 0288 and the buffer holds 288 bytes.` |
| `Current packager has no configured MAC metadata.` | `Packager STX21 defines no MAC field.` + `Choose a packager` + `Edit packager XML` |
| `Field 52 is not present.` | `No field 52 in the decoded message.` + `Add field 52` |
| `Calculate a MAC first.` | `Nothing to apply — run Calculate first.` (rendered as a disabled-button tooltip, so the error never happens) |
| `Ready` | *(nothing — an idle app says nothing)* |
| `Unsupported conversion mode.` | `No conversion from ATM-engine bytes to ANSI text. Pick UTF-8 or Hex output.` |
| `A binary field length does not match its packager size.` | `F055 is 21 bytes; packager STX21 expects 24.` + per-field `Pad with zeros` / `Leave as is` |

---

## 8. Implementation checklist

- [ ] `src/styles/app.css` contains §1.4 verbatim; no component defines a raw color.
- [ ] `data-theme` and `data-density` are set by the §1.5 bootstrap before first paint; no flash.
- [ ] Inter and IBM Plex Mono are self-hosted `woff2`, subset, preloaded; no network font request (CSP-safe for the Tauri build).
- [ ] The §2.1 font QA snapshot passes at 11/12/13/15px in both themes.
- [ ] Automated contrast test asserts every pair in §1.2 in both themes on every CI run.
- [ ] CVD simulation snapshot (deuter/prot/trit) of the 8-hue palette on `surface-inset` in both themes.
- [ ] Stylelint forbids `outline: none` without a paired ring class.
- [ ] A test asserts no element with `data-sensitive="true"` ever reaches the logger, telemetry, the error serializer, `localStorage`, or a URL.
- [ ] A test asserts `localStorage` contains only `bx:theme` and `bx:density`.
- [ ] Reduced-motion snapshot: every animated component renders its static equivalent with no lost information.
- [ ] Every disabled control in the app has a precondition tooltip.
- [ ] Every error string in the app matches the §7 shape and appears inline, not in a global slot.
