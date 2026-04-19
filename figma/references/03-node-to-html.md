# 03 — Node → HTML/CSS 确定性算法

本文是 skill 的核心消费规范。任何模型（含弱模型）按本文流程逐步执行即可写出高还原度代码，无需迭代 heatmap 修复。

## 输入与输出约定

- **输入**：`bridge-agent-payload.json` 中 `designSnapshot.root` 的子树
- **输出**：HTML（或 React/Vue 等等价 DOM 树）+ 一个样式表
- **前置**：已复制 `02-css-reset.md` 的 reset 块到样式表顶部
- **前置**：已加载 `text.fontName.family` 对应的 Google Font / 本地字体

## 节点处理总流程

对每个节点 N，按 1→7 顺序执行。每一步都是"查字段→填模板"，**不允许跳步也不允许重排**。

### Step 1 — 可见性闸

```
if N.visible === false              → return nothing
if N.style.opacity === 0            → return nothing
for each fill in N.style.fills:
  if fill.visible === false         → 该 fill 层跳过（仍渲染其他层）
for each stroke in N.style.strokes:
  if stroke.visible === false       → 该 stroke 层跳过
```

### Step 2 — 选择元素标签

| 节点 | 标签 |
|------|------|
| TEXT（单段）| `<p>` 或 `<span>` |
| TEXT（有 `hyperlink`）| `<a>` |
| TEXT（语义标题） | 按层级 `<h1>`…`<h3>`（父区段高度/字号作判断）|
| FRAME / SECTION / GROUP / COMPONENT / INSTANCE | `<div>` 或语义标签（`<header>` / `<nav>` / `<main>` / `<section>` / `<footer>`）|
| VECTOR / BOOLEAN_OPERATION / STAR / POLYGON / LINE | inline `<svg>`（见 `08-route-escalation.md`）|
| RECTANGLE / ELLIPSE（纯几何无文本）| `<div>` + background 或 inline `<svg>` |

语义标签判断规则（不强求，但鼓励）：
- `node.name` 含 "Nav" / "Header" / "Footer" → 对应语义标签
- 最大字号 TEXT 节点 → `<h1>`；次级 → `<h2>`

### Step 3 — 如果节点带 `computedCss.full`，直接贴并跳到 Step 7

```html
<div style="<node.computedCss.full>">
  <!-- 如果是 TEXT：直接贴 node.computedHtml -->
  <!-- 否则递归子节点 -->
</div>
```

这是 pipeline 富集最终态。**存在即用**，不再回头做 Step 4-6。

### Step 4 — 构造 box + positioning（fallback，无 computedCss 时）

按 `layout.layoutMode` 四档决策，详见 `05-layout-modes.md`。要点：

1. **显式 width/height**：优先读 `layout.absoluteBoundingBox.width/height`（而非 `layout.width/height`），差值常因嵌套 FILL 的父容器重算产生
2. **padding**：`padding: <paddingTop>px <paddingRight>px <paddingBottom>px <paddingLeft>px`
3. **gap**：`itemSpacing` 存在即 `gap: <value>px`
4. **clipsContent**：`true`→`overflow: hidden`；`false`→`overflow: visible`

### Step 5 — 构造 appearance（fallback）

按 style.* 字段，详见 `06-paint-effects.md`。要点：

1. **SOLID fill**：`background-color: <color.hex>`
2. **GRADIENT\* fill**：**禁止手算**，只用 `node.computedCss.background`（pipeline 已产出）
3. **IMAGE fill**：`background-image: url(./assets/<imageHash>.<format>)` + `background-size: <scaleMode-mapped>`
4. **strokes**：渐变描边禁止降级；`strokeAlign: INSIDE` → `border-*`；`OUTSIDE` → `outline`
5. **effects**：按 `style.effects[]` 逐项。**blur radius 用 `style.effects[].radius` 原值**，不用 `node.css.filter`（被 Figma 除以 2）
6. **radius**：四角可能不等，输出 `border-top-left-radius` 等独立值

### Step 6 — TEXT 内容（仅 TEXT 节点）

若 `node.text.segments.length >= 2`，**必须拆 span**。若只有 1 段，可直接 `<span>`+外层字体规则。

伪代码：
```
html = ''
for each segment in node.text.segments:
  style = {
    color: segment.fills[0].color.hex,
    fontWeight: styleToWeight(segment.fontName.style),
    fontSize: segment.fontSize + 'px',
    textDecoration: segment.textDecoration 映射,
    fontStyle: italic?
  }
  if segment.hyperlink: html += `<a href="${segment.hyperlink.url}" style="${style}">${segment.characters}</a>`
  else: html += `<span style="${style}">${segment.characters}</span>`
```

`text.textCase: UPPER` 通过 CSS `text-transform: uppercase` 实现在父节点，不修改 characters。

pipeline 若已产出 `node.computedHtml`，**直接贴，不自己拼**。

### Step 7 — 递归子节点

对 `node.children[]` 中每个子 C：
1. 若父 `layout.layoutMode === 'NONE'`（绝对定位），**按 `absoluteBoundingBox.x/y` 排序子节点**再递归——子节点在 `children[]` 里的顺序 ≠ 视觉顺序
2. 按 Step 1-7 处理 C

---

## 常见陷阱清单（必看）

| 陷阱 | 正解 |
|------|------|
| 直接用 `text.characters` 渲染，忽略 segments | 段数 ≥ 2 时必须拆 span |
| 依靠 flex 自动 sizing 而不设 width | FIXED 尺寸必须 explicit width |
| layoutMode: NONE 当顺序流渲染 | 用 absolute positioning，按 x/y 定位 |
| Nav/logo 子顺序直接用 `children[]` 顺序 | 若父是 NONE，按 x/y 排序 |
| `<h1>` / `<p>` 写完忘了 reset margin | 先复制 `02-css-reset.md` |
| `<a>` 写完忘了 `text-decoration: none` | reset 已含 |
| `<img>` 导致 flex 底部有 3px 间隙 | reset 里 `img { display: block }` |
| blur 值用了 `node.css.filter` 的数 | 用 `style.effects[].radius` 原值（不除以 2）|
| 渐变手算 angle + stops | 用 `computedCss.background` |
| 变量属性硬编码色值 | 若 `computedCss.tokens[prop]` 存在，用 `var(--xxx)` |
| FRAME 高度 < 文本实际高度 | `overflow: hidden` 或加 breathing room |
| footer/overlay 相互覆盖判断错 | 用 `absoluteBoundingBox.y` 判断是否重叠，决定用 absolute |

## 自检列表（写完代码、render 之前跑）

- [ ] Reset 块在样式表最顶部
- [ ] 所有 TEXT 节点的多段都拆了 span
- [ ] 所有 `layoutMode: NONE` 的 FRAME 用了 absolute 定位 + 父 position: relative
- [ ] 所有 GRADIENT fill 的节点使用了 `computedCss.background`
- [ ] 所有 token 绑定输出 `var(--xxx)` 而非硬编码
- [ ] 每个中间 FRAME 有对应 HTML 元素，没有跳过的"包装层"
- [ ] 每个 VECTOR / BOOLEAN_OPERATION 用 inline SVG（path 取自 bridge）
- [ ] Google Font / 本地字体已加载
- [ ] 图片路径 `./assets/<hash>.<format>` 实际存在

通过自检 → 可以首次 render → 跑 `09-verification.md` 里的 scorecard。scorecard SSIM 不应低于 0.95（若低于说明有未执行的 Step，退回定位）。
