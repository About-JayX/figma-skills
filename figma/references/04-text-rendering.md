# 04 — Text Rendering

TEXT 节点的渲染涉及字体、分段、行高、case、换行等多个容易跑偏的点。本文是 **写 TEXT 节点时的唯一规范**。

## 1. 字体加载（前置）

写代码前确认每个用到的 `text.fontName.family` 都已加载：

### Google Fonts（首选）

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=<Family>:wght@400;700;800&display=swap" rel="stylesheet" />
```

`:wght@` 后列出所有用到的 weight（查 `text.segments[].fontWeight`），逗号分号分隔，`display=swap` 避免首帧空白。

### font style → CSS weight 映射

| Figma `fontName.style` | CSS `font-weight` |
|-----------------------|------------------|
| `Thin` | 100 |
| `ExtraLight` | 200 |
| `Light` | 300 |
| `Regular` / `Normal` | 400 |
| `Medium` | 500 |
| `SemiBold` | 600 |
| `Bold` | 700 |
| `ExtraBold` / `Heavy` | 800 |
| `Black` | 900 |

Italic / Oblique 映射到 `font-style: italic` 而非 weight。

### 无 Google Font 时

- 本地 `@font-face` 加载 woff2
- 不能 fallback 到 `sans-serif` 或 `system-ui`，字体度量差异会让 SSIM 从 0.98 掉到 0.92 量级

## 2. 分段渲染（硬规则）

若 `node.text.segments.length >= 2`：**必须**逐段输出 `<span>`，**禁止**用 `text.characters` 作为整段单色渲染。

```html
<!-- 源：text.characters = "Train Hard. Live Better"，2 段不同色 -->
<h1>
  <span>Train Hard. </span>
  <span style="color:#808dfd">Live Better</span>
</h1>
```

每段需要检查这些字段并映射：

| segment 字段 | 仅该段不同时的处理 |
|-------------|-----------------|
| `fills[0].color.hex` | `<span style="color: ...">` |
| `fontName.family` | `<span style="font-family: ...">` |
| `fontName.style` / `fontWeight` | `<span style="font-weight: ...">` |
| `fontSize` | `<span style="font-size: ...px">` |
| `textDecoration` | `text-decoration: underline / line-through` |
| `textCase` | 若与父不同：`text-transform: uppercase / lowercase / capitalize` |
| `hyperlink.url` | 包 `<a href="...">` 替代 `<span>` |
| `letterSpacing` | `letter-spacing: ...` |
| `lineHeight` | `line-height: ...` |
| `openTypeFeatures` | `font-feature-settings` |

pipeline 产出 `node.computedHtml` 时**直接贴**，不自拼。

## 3. 行高（lineHeight）映射

Figma `text.lineHeight.unit` + `value`：

| unit | CSS 等价 |
|------|---------|
| `PIXELS` | `line-height: <value>px` |
| `PERCENT` | `line-height: <value>%` |
| `AUTO` | 不写 `line-height`（使用浏览器默认 normal）|

**注意**：Figma `PERCENT 110%` 和 CSS `line-height: 110%` 行为在大多数字体下一致，但 Anek Tamil 等紧凑字体的 ExtraBold 变体 ascender 可能超过 em-box。若紧贴节点高度（text-height = 节点 height），要么：
- 加 ≥5px 垂直 breathing room（padding-top 加、section height 加）
- 或 `overflow: visible` 于父节点
- 或改用 `line-height: <pixels>px` 显式值 = 节点高度

## 4. 字间距（letterSpacing）

| unit | CSS |
|------|-----|
| `PIXELS` | `letter-spacing: <value>px` |
| `PERCENT` | `letter-spacing: <value/100>em`（比如 -5% → -0.05em）|

负值常见于大字号标题（收紧字距）。

## 5. textCase

| Figma | CSS | 特例 |
|-------|-----|------|
| `ORIGINAL` | （不写）| |
| `UPPER` | `text-transform: uppercase` | 不改源字符串，交给 CSS 转 |
| `LOWER` | `text-transform: lowercase` | |
| `TITLE` | `text-transform: capitalize` | Figma 规则更智能，CSS 是简化版，少数场景有差 |
| `SMALL_CAPS` | `font-variant: small-caps` | 字体需支持 |
| `SMALL_CAPS_FORCED` | `font-variant: all-small-caps` | |

## 6. textAlign

| Figma `textAlignHorizontal` | CSS |
|---------------------------|-----|
| `LEFT` | `text-align: left` |
| `CENTER` | `text-align: center` |
| `RIGHT` | `text-align: right` |
| `JUSTIFIED` | `text-align: justify` |

| Figma `textAlignVertical` | CSS（节点是 flex 容器时）|
|-------------------------|-------------------------|
| `TOP` | `align-items: flex-start` |
| `CENTER` | `align-items: center` |
| `BOTTOM` | `align-items: flex-end` |

若 TEXT 节点自身是直接文字，vertical 对齐需要父节点 flex + align-items。

## 7. 中文文字特别规则

- `12px` / `13px` 字号的中文，浏览器 line-height 容易切下沿。`line-height` 至少 `16px`（留 +2–4px 保护底部笔画）
- 中英文混排时，`letter-spacing` 负值会让汉字之间过密，优先作用于英文段。若需两段不同字距，拆 segment
- `textCase: UPPER` 对汉字无视觉效果，但保留 CSS 属性不影响

## 8. 段间距 / 段首缩进

| Figma | CSS |
|-------|-----|
| `text.paragraphSpacing: N` | 段落间 `margin-bottom: Npx`（或用 gap）|
| `text.paragraphIndent: N` | `text-indent: Npx`（仅首行）|
| `text.listSpacing: N` | 列表项间 `margin-bottom: Npx` |
| `text.listOptions.type: ORDERED/UNORDERED` | `<ol>` / `<ul>` |

## 9. 字体回退策略

```css
font-family: 'Anek Tamil', 'Helvetica Neue', Arial, sans-serif;
```

- 第一位：设计稿指定字体
- 中间：同语言同 weight 的系统字体作为 fallback（保证加载期间视觉接近）
- 末尾：泛族 `sans-serif` / `serif` / `monospace`

## 自检

- [ ] 所有段 ≥ 2 的 TEXT 节点都拆了 span
- [ ] Google Fonts link 包含用到的所有 weight
- [ ] 中文小字号 line-height 已加 +2~4px 保护
- [ ] `textCase` 通过 CSS 而非改字符串实现
- [ ] `hyperlink.url` 段用 `<a>` 不是 `<span>`
- [ ] 负 letter-spacing 转成 em 单位
