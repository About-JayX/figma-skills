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
