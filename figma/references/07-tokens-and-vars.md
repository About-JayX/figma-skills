# 07 — Tokens and Variables

This file defines how to preserve Figma variable bindings as CSS custom properties in reproduction output.

## When to Use This

Use this when:

- a node property is explicitly bound through `node.variables.bound.<prop>`
- the consuming codebase already has a token layer
- the design has multiple modes (light/dark/brand variants)

## Data Sources

Three layers matter:

| Source | Meaning | Use |
|---|---|---|
| `node.variables.bound.<prop>` | explicit per-node variable binding | primary binding source |
| `node.variables.inferred.<prop>` | Figma’s inferred suggestions | informational only; do not force-convert blindly |
| `variables-substitution-map.json` | global variable-name -> CSS-variable map with per-mode values | emit `:root` variables and mode overrides |
| `node.computedCss.tokens` | pipeline-enriched token mapping by CSS prop | direct node-level `var(--...)` emission |

## Consumption Flow

### 1. Emit Global `:root` Variables

Use `variables-substitution-map.json` to emit global variables:

```css
:root {
  --color-brand-500: #0066ff;
  --color-neutrals-950: #0a0a0a;
  --font-size-text-xs: 12px;
  --spacing-sp-0: 0px;
}

[data-theme="dark"] {
  --color-brand-500: #5599ff;
  --color-neutrals-950: #f5f5f5;
}
```

### 2. Use Token-Bound Properties at the Node Level

If `computedCss.tokens[cssProp]` exists, emit:

```css
var(--token-name)
```

instead of a hard-coded literal value.

### 3. Parallel Outputs

The pipeline may expose:

- `computedCss.full` — resolved pixel-faithful values
- `computedCss.withTokens` — equivalent output with `var(--...)` substitutions

Use:

- `full` for pure visual lock / screenshot-faithful work
- `withTokens` when theme-aware output is part of the goal

## Figma Binding Property -> CSS Property Mapping

| Figma binding property | CSS property |
|---|---|
| `fills` | `color` (TEXT) / `background-color` (containers) |
| `strokes` | `border-color` |
| `fontSize` | `font-size` |
| `fontWeight` | `font-weight` |
| `fontName` | `font-family` |
| `lineHeight` | `line-height` |
| `letterSpacing` | `letter-spacing` |
| `itemSpacing` | `gap` |
| `paddingTop/Right/Bottom/Left` | `padding-*` |
| `topLeftRadius` / `topRightRadius` / `bottomLeftRadius` / `bottomRightRadius` | `border-*-radius` |
| `strokeWeight` / per-side stroke weights | `border-width` / `border-*-width` |
| `opacity` | `opacity` |
| `minWidth` / `maxWidth` / `minHeight` / `maxHeight` | same-named CSS properties |
| `paragraphSpacing` / `paragraphIndent` | paragraph gap / `text-indent` |

## CSS Variable Naming Rules

Figma variable names should be normalized into CSS custom properties using these rules:

1. ASCII letters are lowercased
2. Unicode is preserved
3. slashes, spaces, and punctuation collapse into `-`
4. leading/trailing `-` are trimmed
5. every final name is prefixed with `--`

Examples:

- `Color/neutrals/950` -> `--color-neutrals-950`
- `Line Height/text-xs` -> `--line-height-text-xs`
- Unicode names remain valid CSS custom properties

Unicode is allowed here. The important rule is consistency, not forced ASCII-only slugs.

## Multi-Mode Switching

Two common patterns:

### `data-theme`

```html
<html data-theme="dark">
```

```css
[data-theme="dark"] {
  --color-neutrals-950: #f5f5f5;
}
```

### `prefers-color-scheme`

```css
@media (prefers-color-scheme: dark) {
  :root {
    --color-neutrals-950: #f5f5f5;
  }
}
```

These approaches can coexist.

## Unresolved / Conflict Cases

| Situation | Handling |
|---|---|
| a mode is missing a value | fall back to the default mode or report a warning |
| token name collision / naming conflict | report the collision; rename or scope intentionally |
| multiple inferred candidates | do not auto-convert inferred bindings blindly |
| consumer token names differ from Figma names | use an aliasing layer or explicit mapping |

## Self-Check

- [ ] every property with `computedCss.tokens[prop]` emits `var(--...)`
- [ ] `:root` contains every used variable
- [ ] mode overrides are emitted when the design has multiple modes
- [ ] inferred-only bindings were not silently forced into CSS vars
- [ ] naming collisions or conflicts are explicitly handled
