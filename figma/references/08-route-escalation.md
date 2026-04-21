# 08 — Route Escalation：DOM → SVG → Canvas → Raster

并非所有节点都能用纯 DOM/CSS 还原。本文定义六档渲染路由 + 升级链路 + 触发条件。

## 六档路由

| 路由 | 适用场景 |
|------|---------|
| `DOM_NATIVE` | 普通 frame / group / 矩形 / 文本 / 图片、设计系统稳定实例 |
| `DOM_INFERRED` | 无显式 auto layout 但 `inferredAutoLayout` 可信 |
| `DOM_GRID` | grid 语义明确、轨道 / gap / span 字段完整 |
| `SVG_ISLAND` | mask / boolean op / 复杂 vector / text path / pattern / 复杂渐变 / variable width stroke |
| `CANVAS_ISLAND` | progressive blur / glass / noise / texture / 多重过滤合成顺序敏感 |
| `RASTER_LOCK` | 升级链路最后一级，必须记录理由 |

## 升级链路

```
DOM_NATIVE → DOM_INFERRED → DOM_GRID → SVG_ISLAND → CANVAS_ISLAND → RASTER_LOCK
```

## 升级粒度

路由升级不只发生在“单个节点”上，还可能发生在更大的视觉单元：

| 粒度 | 说明 |
|------|------|
| 节点级 | 单个 hard node 升级，如一个 icon / chart / mask group |
| 子树级 / subtree | 一个 section / hero / pricing block 作为整体升级 |
| 页面级 / page-level | root 或覆盖整页的装饰层整体升级 |

优先级：
- 先尝试节点级
- 连续多个相邻节点共享同一种 hard drift，可升到子树级
- 只有当页面交互很弱、误差主要由整页装饰层造成时，才允许 page-level 升级

page-level 升级是强手段，不是默认路径。它更接近 `Visual-lock` 交付，而不是纯 DOM fidelity。

每个箭头对应一个触发条件：

### DOM_NATIVE → DOM_INFERRED

`layout.layoutMode === 'NONE'` + `layout.inferredAutoLayout` 存在 + 视觉验证（scorecard region-mode ≥ 0.985 SSIM）通过。升级后按 `05-layout-modes.md` 的 FLEX 档写。

### DOM_INFERRED → DOM_GRID

`layout.gridRowCount` 或 `gridColumnCount` 存在。按 grid 档写。

### DOM_GRID → SVG_ISLAND

命中任一 "硬信号"：

| 硬信号 | 字段 |
|--------|------|
| 是 mask | `node.isMask === true` |
| boolean 运算后节点 | `node.type === 'BOOLEAN_OPERATION'` |
| 有 pattern 填充 | `fills[].type === 'PATTERN'` |
| video paint 带 filters | `fills[].type === 'VIDEO'` + `fills[].filters` |
| 复杂描边 | `complexStrokeProperties.type !== 'BASIC'` |
| 变宽描边 | `variableWidthStrokeProperties.variableWidthPoints.length > 0` |
| text path | `node.textPathStartData` |
| 多条 vectorPaths | `vectorPaths.length > 1` |
| noise / texture / glass 材质 | `fills[].filters` 有 noise / texture 相关参数 |
| progressive blur | `effects[].blurType === 'PROGRESSIVE'` |

命中即不能用纯 DOM，生成 inline `<svg>`。

当误差不是单个节点，而是整个视觉块共享同类 hard signal（例如一整块营销 hero 的噪点、复杂描边、布尔路径、装饰层）时，允许直接把**子树级 / subtree** 升到 `SVG_ISLAND`。

### 任意 DOM 路由 → 页面级 `SVG_ISLAND`

满足以下条件时，允许把 root 或大面积页面表面直接升级为 page-level `SVG_ISLAND`：

- 当前页面以营销展示、一次性活动页、静态叙事页为主，真实交互很少
- scorecard 多轮都显示 diffBounds 覆盖大面积页面，而主要误差来自 hard node / decorative layer
- root 或大面积容器已有 `svgRef` / `svgString`，且视觉验证明确优于 DOM-first
- 结果报告中会显式标注交付模式为 `Visual-lock` 或 `Hybrid-SVG`

如果页面有关键按钮、输入、切换、hover 状态，这些交互节点必须拆出锁定区域，不能被 page-level overlay 吃掉。

### SVG_ISLAND → CANVAS_ISLAND

- 多重滤镜合成顺序敏感（SVG `<filter>` 链不够表达）
- 需要像素级精确合成（比如实时模糊半径响应滚动）
- SVG 路径过重（>50KB）影响首帧

用 `<canvas>` + 2D context 或 WebGL 绘制。

### CANVAS_ISLAND → RASTER_LOCK

最后一级，直接把该节点作为一张 PNG（来自 plugin exportAsync）嵌入。记录原因：

```json
{
  "nodeId": "20:532:insert-x",
  "route": "RASTER_LOCK",
  "reason": "Canvas 仍无法通过 0.99 SSIM（hard-node 档）",
  "baselineSrc": "plugin-exportAsync-2x"
}
```

## SVG_ISLAND 实现要点

### 使用 bridge 的 path

- VECTOR / BOOLEAN_OPERATION：读 `vector.fillGeometry[].path` 作为 SVG `<path d="...">`
- 禁止占位符、简化路径、猜测几何
- fill 颜色从 `node.css.fill` 或 `node.style.fills[0]` 取

### 优先用完整 `svgString`

`node.svgRef` 存在（bridge 通过 blob 上传的完整 SVG）时直接 inline，比逐 path 拼更准确：

```html
<!-- 从 cache/.../blobs/svg-<nodeId>.svg 读 -->
<svg>...</svg>
```

### 不要动 viewBox

保留 bridge 给的 `<svg viewBox>`，外层 `<div>` 控制显示尺寸通过 CSS `width/height`。

### overlay 实现约束

常见实现是“底层保留 DOM 壳层，顶层加 overlay 图像 / SVG”：

- overlay 元素默认 `aria-hidden="true"`，只承担视觉职责
- overlay 若使用绝对定位，应保证尺寸锚定到当前节点的 box，不要额外改几何
- 保留底层 DOM 的 `id` / `className`，便于审计、diff 定位和后续交互拆分
- 真正需要点击、hover、focus 的元素必须处于 overlay 之上，或不纳入锁定区域
- 整块锁图时，要在验收报告里列出 locked regions，而不是假装这些区域仍是普通 DOM 还原

### 与静态 lint 的关系

`SVG_ISLAND` / `CANVAS_ISLAND` / `RASTER_LOCK` 的内部子节点，不应继续按普通 flex / gap / geometry 规则逐项解释：

- 普通 DOM 布局 lint 适用于 `DOM_NATIVE` / `DOM_INFERRED` / `DOM_GRID`
- 对 `SVG_ISLAND` 来说，重点是 route 是否正确、资源是否可解析、视觉验收是否通过
- 如果某个静态规则假设“子节点必须严格满足盒模型求和”，但当前节点已经被 route 锁给 SVG，那么该规则应豁免或降级为说明性提示

换句话说：hard-node route 的正确性优先于把它伪装成一个完美的 flex 盒模型。

## CANVAS_ISLAND 实现要点

- React 组件里用 `useEffect + useRef` 访问 canvas context
- 复杂合成可用 `OffscreenCanvas` 离屏渲染
- 性能敏感节点考虑 `requestAnimationFrame` + 节流
- 必须加回退：canvas 不支持时降级到 RASTER

## RASTER_LOCK 实现要点

- 图片来源：plugin `exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } })`
- 路径：`./assets/_baseline_<nodeId>.png`（pipeline 新增的 A8 通道）
- 尺寸：节点原始尺寸，用 CSS 缩到 1x
- 必须加 `alt` 或 `aria-label`（无障碍）

## 不可路由的 DOM 陷阱

即使走 `DOM_NATIVE`，这些情况必须用 SVG：

- `filter: blur()` + `mix-blend-mode` 同元素（filter 建立隔离栈，blend 目标变）→ 拆父子层或 SVG
- 渐变 stroke（CSS `border` 不支持）→ mask-composite 或 SVG
- 带 gradientTransform 的 radial-gradient 在旋转节点上（`node.css` 参数基于未旋转坐标系）→ SVG 或按矩阵计算

## 组件感知

`componentPropertyDefinitions` / `componentPropertyReferences` / `variantProperties` / `resolvedVariableModes` 决定组件实例的变体与 mode。写代码前如果组件契约不清，不要过早绑定 adapter——可能应走 `DOM_INFERRED` 而不是按 instance 结构展开。

## 验收与 rerender loop

每次跑 scorecard 后若某节点未达阈值（见 `09-verification.md`），按本文链路向上升级并记录原因。rerender loop 最多 3 轮，单调收敛否则回退。

## 自检

- [ ] 每个 hard signal 命中的节点都用了 SVG / Canvas / Raster
- [ ] SVG inline 的 path 来自 bridge，不是占位符
- [ ] filter + blend 已经拆层或升级到 SVG
- [ ] 渐变 stroke 没用 `border`
- [ ] RASTER_LOCK 节点记录了升级理由
