# 06 — Paint / Effects

fill、stroke、gradient、image、mask、shadow、blur 的字段到 CSS 的映射。涉及渐变/mask/effects 时，`computedCss.background` / `computedCss.appearance` 若存在优先用。

## Fill 层（`style.fills[]`）

fills 是**数组**，多个 fill 从上往下叠加（index 0 在最上层）。叠加方式：CSS 多 background（逗号分隔）或多层 absolute div。

### SOLID

```css
background-color: <color.hex>;
/* 或多 fill 叠加时 */
background: <color.hex>;
```

alpha：`color.a` 不为 1 时 → `rgba(<r>, <g>, <b>, <a * fill.opacity>)`

### GRADIENT_LINEAR / RADIAL / ANGULAR / DIAMOND

**禁止手算**（矩阵反演 + 角度换算易错）。必须使用 `node.computedCss.background`（pipeline 产出）。

```html
<div style="background: <computedCss.background>"></div>
```

若 pipeline 未产出（极少见的故障路径），退回读：
- `style.fills[].gradientStops[]`（position + color）
- `style.fills[].gradientTransform`（2×3 矩阵）
- `layout.absoluteBoundingBox`（推算手柄像素坐标）

并调用 `scripts/lib/gradient_to_css.mjs` 的 `gradientPaintToCss()`。

### IMAGE

```css
background-image: url('./assets/<imageHash>.<format>');
background-size: <scaleMode 映射>;
background-position: <imageTransform 映射>;
background-repeat: no-repeat;
```

| `scaleMode` | CSS `background-size` |
|-------------|----------------------|
| `FILL` | `cover` |
| `FIT` | `contain` |
| `CROP` | `100% 100%`（即 stretch，配合 imageTransform 做 pan/zoom）|
| `TILE` | 由 `tileType` / `scalingFactor` 决定，用 `background-repeat: repeat` + 显式 `background-size: <scalingFactor>%` |

`imageTransform` 非单位矩阵时要额外计算 `background-position` 百分比。大多数场景 FILL + 默认居中即可。

对 `<img>` 标签：`object-fit: cover | contain`；`object-position: center` 默认。

### VIDEO / PATTERN

- VIDEO：`<video autoplay muted loop>` + 同 imageHash 机制取资源
- PATTERN：用 `sourceNodeId` 引用的子树生成 SVG 然后 `<pattern>` 或 repeating bg。复杂度高，一般走 `SVG_ISLAND` 渲染（见 `08-route-escalation.md`）

## Stroke 层（`style.strokes[]`）

结构同 fills，但作用于边框。

### SOLID stroke

```css
border-width: <strokeWeight>px;
border-style: solid;
border-color: <color.hex>;
```

单边粗细用 `layout.strokeTop/Right/Bottom/LeftWeight`，对应 `border-*-width`。

### GRADIENT stroke（降级陷阱）

`node.css.border` 会被 Figma 降级为 solid。**禁止使用**。正确实现：

**方案 A**：mask-composite
```css
.box {
  position: relative;
}
.box::before {
  content: '';
  position: absolute; inset: 0;
  padding: <strokeWeight>px;
  background: <computedCss.background>;
  -webkit-mask: linear-gradient(#000 0 0) content-box,
                linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
          mask-composite: exclude;
}
```

**方案 B**：渐变背景 + padding + 内层
```css
.box {
  background: <gradient>;
  padding: <strokeWeight>px;
  border-radius: <radius>;
}
.box > .inner {
  background: <inner-bg>;
  border-radius: <radius - strokeWeight>;
}
```

### `strokeAlign`

见 `05-layout-modes.md`「盒模型与 stroke 对齐」节。

## Effects（`style.effects[]`）

按顺序逐个映射。同一元素 `filter` + `mix-blend-mode` 同时存在时必须拆父子层（filter 创建隔离栈，blend 目标会变）。

### LAYER_BLUR

```css
filter: blur(<radius>px);
```

**radius 用原值**（`style.effects[].radius`），**不用** `node.css.filter` 的值（Figma 导出时除以 2）。

### BACKGROUND_BLUR

```css
backdrop-filter: blur(<radius>px);
-webkit-backdrop-filter: blur(<radius>px);
```

父容器可能需要 `isolation: isolate` 才可见。`blurType: PROGRESSIVE` CSS 无原生支持，用 `mask-image` 限制 blur 区域近似。

### DROP_SHADOW

```css
box-shadow: <offset.x>px <offset.y>px <radius>px <spread>px <color rgba>;
```

多个 DROP_SHADOW 可合并为逗号分隔列表。

### INNER_SHADOW

```css
box-shadow: inset <offset.x>px <offset.y>px <radius>px <spread>px <color rgba>;
```

### effect 的 `visible: false`

跳过该 effect。不要默默渲染出来再用 CSS 盖掉。

## Mask（`node.isMask`）

| `maskType` | CSS 映射 |
|-----------|---------|
| `ALPHA` | `mask-image: <bg>` + `-webkit-mask-image` |
| `VECTOR` | `clip-path: path('<svg-path>')` 或 SVG `<clipPath>` |
| `LUMINANCE` | `mask-mode: luminance` 或 SVG `feColorMatrix` |

mask 实现普遍复杂，多数情况下升级为 `SVG_ISLAND` 路由（见 `08-route-escalation.md`），用 `<svg><mask>` + inline path。

## Blend Modes

| Figma | CSS |
|-------|-----|
| `PASS_THROUGH` | 不写 |
| `NORMAL` | `mix-blend-mode: normal` |
| `MULTIPLY` | `mix-blend-mode: multiply` |
| `SCREEN` | `mix-blend-mode: screen` |
| `OVERLAY` | `mix-blend-mode: overlay` |
| `DARKEN` / `LIGHTEN` / `COLOR_DODGE` / `COLOR_BURN` / `HARD_LIGHT` / `SOFT_LIGHT` / `DIFFERENCE` / `EXCLUSION` / `HUE` / `SATURATION` / `COLOR` / `LUMINOSITY` | 同名 `mix-blend-mode` |

## Corner Radius

Bridge 按两种结构序列化，**不共存**：

- 四角均等 → `style.cornerRadius` 单值
- 四角不等 → `style.cornerRadii.{topLeft, topRight, bottomRight, bottomLeft}` 对象

```css
/* 均等（style.cornerRadius 存在）*/
border-radius: <cornerRadius>px;

/* 不等（style.cornerRadii 存在）*/
border-top-left-radius:     <cornerRadii.topLeft>px;
border-top-right-radius:    <cornerRadii.topRight>px;
border-bottom-right-radius: <cornerRadii.bottomRight>px;
border-bottom-left-radius:  <cornerRadii.bottomLeft>px;
```

**禁止**读 `style.topLeftRadius` 这种扁平字段——不存在，读到的永远是 undefined。

## Opacity

| 字段 | CSS |
|------|-----|
| `style.opacity` | `opacity: <value>` |
| `style.fills[].opacity` | 乘到该层色 alpha（或 `rgba()`）|
| `style.effects[].color.a` | shadow 色已含 alpha |

## z-order 与 stroke

Figma 里 stroke 默认在 fill 之上。CSS 里 `border` 天然在 background 之上。若节点用多层 DOM 模拟（比如渐变 stroke 方案 A/B），确认 stroke 层在 fill 层之上（DOM 顺序或显式 z-index）。

## 自检

- [ ] 所有 GRADIENT fill 用了 `computedCss.background`，没手算
- [ ] 渐变 stroke 没降级为 solid border
- [ ] blur radius 用 `style.effects[].radius` 原值
- [ ] filter 和 mix-blend-mode 不在同一元素
- [ ] 多 fill / 多 effect 的顺序和 Figma 一致（index 0 最上）
- [ ] IMAGE fill 的 `scaleMode` 正确映射到 `background-size` 或 `object-fit`
