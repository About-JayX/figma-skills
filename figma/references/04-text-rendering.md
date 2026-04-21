# 04 — Text Rendering

TEXT reproduction often fails on fonts, segmentation, line-height, casing, and wrapping. This file is the single normative guide for TEXT nodes.

## 1. Font Loading Comes First

Before writing or validating text output, make sure every used `text.fontName.family` is actually loaded.

### Google Fonts (Preferred)

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=<Family>:wght@400;700;800&display=swap" rel="stylesheet" />
```

List every required weight. Use italic tuples (`ital,wght@0,400;1,400`) when needed. `display=swap` prevents blank first paint, but you still need enough capture budget before screenshotting.

### No Google Font Available

- load a local `@font-face`
- do not silently fall back to `system-ui` / generic `sans-serif` if fidelity matters

Even “close enough” fallback fonts can move SSIM significantly when typography is prominent.

## 2. Font Style -> CSS Weight Mapping

| Figma `fontName.style` | CSS |
|---|---|
| `Thin` | `font-weight: 100` |
| `ExtraLight` | `font-weight: 200` |
| `Light` | `font-weight: 300` |
| `Regular` / `Normal` | `font-weight: 400` |
| `Medium` | `font-weight: 500` |
| `SemiBold` | `font-weight: 600` |
| `Bold` | `font-weight: 700` |
| `ExtraBold` / `Heavy` | `font-weight: 800` |
| `Black` | `font-weight: 900` |

Italic / Oblique should map to `font-style: italic`, not a heavier weight.

## 3. Segmented Rendering (Hard Rule)

If `node.text.segments.length >= 2`, split the text into spans (or links). Do not render the whole string as a single text node.

```html
<h1>
  <span>Train Hard. </span>
  <span style="color:#808dfd">Live Better</span>
</h1>
```

Per-segment checks include:

- `fills[0].color.hex`
- `fontName.family`
- `fontName.style` / `fontWeight`
- `fontSize`
- `textDecoration`
- `textCase`
- `hyperlink.url`
- `letterSpacing`
- `lineHeight`
- `openTypeFeatures`

If `node.computedHtml` exists, prefer it directly.

## 4. Line-Height Mapping

| Figma unit | CSS output |
|---|---|
| `PIXELS` | `line-height: <value>px` |
| `PERCENT` | `line-height: <value>%` |
| `AUTO` | usually omit explicit `line-height` |

When the node is tightly sized to the text block, consider adding a few pixels of safety instead of assuming font metrics will match perfectly.

## 5. Letter Spacing

| Figma unit | CSS |
|---|---|
| `PIXELS` | `letter-spacing: <value>px` |
| `PERCENT` | `letter-spacing: <value/100>em` |

Negative values are common in large titles.

## 6. textCase

| Figma | CSS |
|---|---|
| `ORIGINAL` | omit |
| `UPPER` | `text-transform: uppercase` |
| `LOWER` | `text-transform: lowercase` |
| `TITLE` | `text-transform: capitalize` |
| `SMALL_CAPS` | `font-variant: small-caps` |
| `SMALL_CAPS_FORCED` | `font-variant: all-small-caps` |

Use CSS transforms instead of mutating the source string.

## 7. textAlign

| Figma horizontal alignment | CSS |
|---|---|
| `LEFT` | `text-align: left` |
| `CENTER` | `text-align: center` |
| `RIGHT` | `text-align: right` |
| `JUSTIFIED` | `text-align: justify` |

| Figma vertical alignment | Common CSS interpretation |
|---|---|
| `TOP` | `align-items: flex-start` on a parent wrapper |
| `CENTER` | `align-items: center` |
| `BOTTOM` | `align-items: flex-end` |

## 8. CJK and Mixed-Language Rules

- Small CJK text at 12–13px is especially vulnerable to clipping if line-height is too tight
- When mixed Latin/CJK text uses negative letter-spacing, treat it carefully; what looks fine for Latin can over-tighten CJK
- `textCase: UPPER` has no visual effect on Han characters, but the CSS property is still safe to keep

## 9. Paragraph Spacing and Indent

| Figma | CSS |
|---|---|
| `paragraphSpacing` | paragraph gap or `margin-bottom` |
| `paragraphIndent` | `text-indent` |
| `listSpacing` | list-item spacing |
| `listOptions` | `ul` / `ol` semantics where relevant |

## 10. Font Fallback Strategy

```css
font-family: 'Primary Family', 'Close Fallback', Arial, sans-serif;
```

Recommended order:

1. the design font
2. a same-category fallback with similar metrics
3. a final generic family

The goal is to minimize visible drift during font loading and in degraded environments.

## Self-Check

- [ ] all segment-rich TEXT nodes are split
- [ ] the required font requests include every used weight/style
- [ ] small CJK text is not clipping because of a too-tight line-height
- [ ] `textCase` is represented through CSS, not string mutation
- [ ] hyperlink segments use `<a>`, not plain spans
- [ ] negative letter-spacing is converted correctly
- [ ] paragraph spacing / indent rules are not silently dropped
