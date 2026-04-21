# 02 — Required CSS Reset

Paste this block at the top of the stylesheet before writing reproduction CSS. Skipping it causes browser defaults to shift text, buttons, links, and image alignment enough to materially damage SSIM.

## Reset Template

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
h1, h2, h3, h4, h5, h6,
p, button, a,
ul, ol, li, dl, dt, dd,
figure, blockquote, form, fieldset {
  margin: 0;
  padding: 0;
  font: inherit;
  color: inherit;
  background: transparent;
  border: 0;
}
a { text-decoration: none; }
button { cursor: pointer; }
img, svg, video { display: block; max-width: 100%; }
input, textarea, select { font: inherit; color: inherit; background: transparent; border: 0; outline: 0; }
table { border-collapse: collapse; }
```

## Why Each Rule Matters

| Rule | What breaks if omitted |
|---|---|
| `margin: 0; padding: 0` | Default heading and paragraph margins shift vertical alignment |
| `font: inherit; color: inherit` on controls | System fonts replace design fonts |
| `background: transparent` on buttons | Browser default gray button background appears |
| `border: 0` on buttons / fieldsets | Native borders distort geometry |
| `a { text-decoration: none }` | Browser underlines appear |
| `img { display: block }` | Image baseline alignment introduces bottom gaps |
| `box-sizing: border-box` | Padding and borders change measured widths |
| `input border/outline reset` | Default focus rings appear during testing |

## Placement

- React / Vite / Next: top of the global stylesheet
- Vue: top of the shared app stylesheet
- Single-file HTML: top of the first `<style>` block

If Tailwind preflight is disabled, this block is mandatory. If preflight is enabled, still verify headings, links, and media behavior match the required reset.
