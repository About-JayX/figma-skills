# 01 — Data Sources：agent-payload 字段权威表

所有字段出自 `bridge-agent-payload.json`（pipeline 产出的精简版，不是 `bridge-response.json`）。字段存在性按 type 区分——FRAME 有 layout，TEXT 多一层 text。

## 读取顺序（硬规定）

1. `node.id` / `node.type` / `node.name` / `node.visible` / `node.style.opacity`
2. `node.layout.*`（几何）
3. `node.style.*`（外观）
4. `node.text.*`（只对 TEXT）
5. `node.vector.*`（只对 VECTOR / BOOLEAN_OPERATION / STAR / POLYGON / LINE）
6. `node.component.*`（只对 INSTANCE / COMPONENT）
7. `node.variables.bound` / `node.computedCss.tokens`（token 场景）
8. `node.computedCss.*`（pipeline 富集产出，优先级最高，见下）
9. `node.children[]`（递归）

`node.computedCss.*` 是 pipeline 为消除 agent 再推理而产出的**终值**字段，存在即用，不再回去重算。

## Layout（几何层）

| 字段 | 含义 | CSS 对应 | 注意 |
|------|------|---------|------|
| `layout.absoluteBoundingBox.{x,y,width,height}` | 含 stroke 的绝对盒 | width / height 权威源 | 嵌套 FILL 场景此值比 `layout.width/height` 准 |
| `layout.absoluteRenderBounds.{x,y,width,height}` | 含 effects 溢出 | 父若 `overflow: visible` 时实际绘制边界 | 边缘对齐以此为准 |
| `layout.layoutMode` | `VERTICAL` / `HORIZONTAL` / `NONE` | → `05-layout-modes.md` 决策树 | `NONE` = 绝对定位，不是顺序流 |
| `layout.itemSpacing` | auto-layout 主轴 gap | `gap` | |
| `layout.counterAxisSpacing` | wrap 时副轴 gap | `row-gap` | |
| `layout.paddingTop/Right/Bottom/Left` | 内边距 | `padding` | |
| `layout.layoutSizingHorizontal/Vertical` | `FIXED` / `FILL` / `HUG` | FIXED→显式 width/height；FILL→`align-self:stretch` 或 `flex:1 0 0`；HUG→auto | |
| `layout.layoutAlign` / `layoutGrow` | 子在父内的对齐/拉伸 | `align-self` / `flex-grow` | |
| `layout.clipsContent` | 是否裁剪 | `overflow: hidden` / `visible` | |
| `layout.relativeTransform` | 父内相对变换（2x3 仿射） | 旋转节点用 `transform: rotate` 或矩阵 | 非单位矩阵时不要信 `node.css.radial-gradient` |
| `layout.gridRowCount` / `gridColumnCount` / `gridRowSizes` / `gridColumnSizes` / `gridRowGap` / `gridColumnGap` | grid 容器定义 | `display:grid` + `grid-template-*` | 存在即走 grid 档 |
| `layout.gridRowSpan` / `gridColumnSpan` / `gridRowAnchorIndex` / `gridColumnAnchorIndex` | grid 子定义 | `grid-column` / `grid-row` + `span` | |
| `layout.minWidth/maxWidth/minHeight/maxHeight` | 尺寸约束 | 同名 CSS 属性 | |
| `layout.constraints.horizontal/vertical` | Figma 约束（MIN/MAX/CENTER/STRETCH/SCALE）| 绝对定位时 MIN=`left`, MAX=`right`, CENTER=居中, STRETCH=`left+right` | 仅在 layoutMode: NONE 下相关 |
| `layout.strokeTopWeight` 等 | 单边描边粗细 | `border-*-width` | 取代 `style.strokeWeight` |
| `layout.inferredAutoLayout` | Figma 推断的 auto layout | 当 `layoutMode: NONE` 但视觉上是行/列时，可升级到 flex | 只有 `replay.routeHint` 允许才用 |

## Style（外观层）

| 字段 | 含义 | CSS 对应 | 注意 |
|------|------|---------|------|
| `style.opacity` | 节点整体透明度 | `opacity` | 与 fill opacity 不同 |
| `style.blendMode` | 混合模式 | `mix-blend-mode` | `PASS_THROUGH` 不写 |
| `style.fills[]` | 填充列表（可多层）| 见下 | |
| `style.fills[].type` | `SOLID` / `GRADIENT_LINEAR` / `GRADIENT_RADIAL` / `GRADIENT_ANGULAR` / `GRADIENT_DIAMOND` / `IMAGE` / `VIDEO` / `PATTERN` | 走不同映射 | |
| `style.fills[].visible` | 单层可见性 | `false` 则忽略这层 | |
| `style.fills[].opacity` | 单层不透明度 | 乘到 stop / color alpha | |
| `style.fills[].color.hex` | SOLID 颜色 HEX | `background-color` / `color` | 优先于 `color.{r,g,b}` 读 |
| `style.fills[].gradientStops[].{position, color}` | 渐变色标 | → `06-paint-effects.md` | 手算复杂，**用 `computedCss.background`** |
| `style.fills[].gradientTransform` | 渐变变换矩阵（2x3）| 用来求手柄真实坐标 | 同上，交给 `computedCss.background` |
| `style.fills[].imageHash` | 图片引用 hash | `background-image: url(assets/<hash>.<format>)` | 文件位于 `cache/.../assets/` |
| `style.fills[].scaleMode` | `FILL` / `FIT` / `CROP` / `TILE` | `cover` / `contain` / `100% 100%` / `repeat` | |
| `style.fills[].imageTransform` | 图片变换（2x3）| `background-position` / `background-size` | |
| `style.strokes[]` | 描边列表 | 同 fill 结构 | 渐变描边不能降级为 solid，必须 mask-composite 或渐变 bg + padding |
| `style.strokeAlign` | `INSIDE` / `CENTER` / `OUTSIDE` | INSIDE→`box-sizing:border-box`+`border`；OUTSIDE→`outline` 或外层 wrapper | |
| `style.effects[]` | 效果列表 | → `06-paint-effects.md` | |
| `style.effects[].type` | `LAYER_BLUR` / `BACKGROUND_BLUR` / `DROP_SHADOW` / `INNER_SHADOW` | `filter: blur` / `backdrop-filter: blur` / `box-shadow` / inset | |
| `style.effects[].radius` | blur/shadow 半径 **原值** | 直接用 | `node.css.filter` 的值被 Figma 除以 2，**不要用** |
| `style.effects[].offset.{x,y}` | shadow 偏移 | `box-shadow x y` | |
| `style.effects[].spread` | shadow 扩散 | `box-shadow spread` | |
| `style.effects[].color` | shadow 色 | `box-shadow color` | |
| `style.topLeftRadius` / `topRightRadius` / `bottomLeftRadius` / `bottomRightRadius` | 四角 radius | `border-*-radius` | 均等时可合为 `border-radius` |

## Text（仅 TEXT 节点）

| 字段 | 含义 | CSS 对应 | 注意 |
|------|------|---------|------|
| `text.characters` | 完整文本 | 元素内文字 | **若 segments 长度 >1，必须用 segments，不能用这个** |
| `text.segments[]` | 按样式分段 | 逐段 `<span>` | 见 `04-text-rendering.md` |
| `text.fontName.family/style` | 字族 + 字型 | `font-family` / `font-weight+style` | style 解析为 weight（Regular=400, Bold=700, ExtraBold=800）|
| `text.fontSize` | 字号 | `font-size` | px |
| `text.lineHeight.{unit, value}` | 行高 | `line-height` | `PERCENT`→`<value>%`；`PIXELS`→`<value>px`；`AUTO`→不写 |
| `text.letterSpacing.{unit, value}` | 字距 | `letter-spacing` | `PERCENT`→`<value/100>em`；`PIXELS`→`<value>px` |
| `text.textAlignHorizontal` | `LEFT` / `CENTER` / `RIGHT` / `JUSTIFIED` | `text-align` | |
| `text.textAlignVertical` | `TOP` / `CENTER` / `BOTTOM` | `align-items` in flex | 或 `align-content` |
| `text.textCase` | `UPPER` / `LOWER` / `TITLE` / `ORIGINAL` | `text-transform` | UPPER→uppercase；TITLE→capitalize |
| `text.textDecoration` | `UNDERLINE` / `STRIKETHROUGH` / `NONE` | `text-decoration` | |
| `text.segments[].fills[0].color.hex` | 单段颜色 | `<span>` 的 `color` | |
| `text.segments[].hyperlink.url` | 链接 | 包 `<a href>` | |
| `text.paragraphSpacing` / `paragraphIndent` | 段间距 / 段首缩进 | `margin-bottom` / `text-indent` | |

## Vector（仅矢量节点）

| 字段 | 含义 | 用途 |
|------|------|------|
| `vector.fillGeometry[].path` | 填充 SVG path | inline `<svg><path d="..." />` |
| `vector.strokeGeometry[].path` | 描边 SVG path | 同上 |
| `vector.vectorPaths[]` | 原始路径（布尔运算前）| VectorNetwork 未暴露时的次优 |
| `vector.handleMirroring` | 贝塞尔 handle 行为 | 重构曲线时参考 |
| `node.svgRef` / `node.svgString` | 完整 SVG 字符串 | 直接贴入 `<svg>`（blob 或 inline）|

## Computed CSS（pipeline 富集，**优先级最高**）

这些字段由 pipeline 在提取后计算并回写 agent-payload，**存在即用**，禁止回去手算。

| 字段 | 何时存在 | 内容 | 使用 |
|------|---------|------|------|
| `node.computedCss.background` | 节点有 `GRADIENT_*` fill | 精算好的 `linear/radial/conic-gradient(...)` 字符串 | 直接贴 `background: <value>` |
| `node.computedCss.tokens` | 节点 `variables.bound` 非空 | `{[cssProp]: {cssVar, figmaProp, variable}}` | 对应 CSS 属性输出 `var(<cssVar>)` 而非硬编码 |
| `node.computedCss.box` | 有 layout | `{width, height, padding, gap, minWidth, ...}` | 直接映射 CSS |
| `node.computedCss.positioning` | 有 layout | `{mode:'flex'\|'absolute'\|'grid', flexDir, justify, align, left, top}` | `display:flex` + 其他 |
| `node.computedCss.appearance` | 有 style | `{backgroundColor, border, borderRadius, opacity, filter, boxShadow, clipPath, maskImage}` | 直接贴 |
| `node.computedCss.full` | 所有上面聚合 | 一个 inline 样式字符串 | `<div style="<computedCss.full>">` 直接贴，agent 零推理 |
| `node.computedHtml` | TEXT 节点 | 预拼的 `<span>...</span><span style="color:#..."...` | 直接贴 |

## 变量绑定

| 字段 | 含义 |
|------|------|
| `node.variables.bound.<prop>` | 显式绑定（必须用 CSS 变量替换）|
| `node.variables.inferred.<prop>` | Figma 推断的匹配（信息性，不强转）|
| `variables-substitution-map.json`（cache 目录）| 变量名 → CSS 变量名 + 多 mode 值 |

详见 `07-tokens-and-vars.md`。

## 交叉校验产物

| 文件 | 内容 |
|------|------|
| `cross-validation-report.json` | pipeline 跑的 HIGH/MEDIUM/INFO 警告列表 |

**HIGH 警告必须在写代码前处理**（退回检查相关字段，确认取值来源）。
