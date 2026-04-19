# 05 — Layout Modes：四档决策树

Figma 节点的布局有四种模式，对应 CSS 不同实现。**禁止**用"肉眼判断是行还是列"，必须先读 `layout.layoutMode` + `gridRowCount` 字段走决策树。

## 决策树

```
if layout.gridRowCount OR layout.gridColumnCount:
  → GRID 档
elif layout.layoutMode === 'VERTICAL':
  → FLEX_COLUMN 档
elif layout.layoutMode === 'HORIZONTAL':
  → FLEX_ROW 档
elif layout.layoutMode === 'NONE':
  if layout.inferredAutoLayout AND 允许升级:
    → FLEX_INFERRED 档
  else:
    → ABSOLUTE 档
else:
  → 该节点不参与布局（可能是 TEXT/VECTOR 等叶节点）
```

## FLEX_ROW / FLEX_COLUMN 档

```css
.node {
  display: flex;
  flex-direction: row | column;                   /* 按 layoutMode */
  gap: <itemSpacing>px;                            /* 主轴 gap */
  row-gap: <counterAxisSpacing>px;                 /* 可选，wrap 时副轴 */
  padding: <paddingTop>px <paddingRight>px <paddingBottom>px <paddingLeft>px;
  justify-content: <primaryAxisAlignItems 映射>;
  align-items: <counterAxisAlignItems 映射>;
  flex-wrap: <layoutWrap 映射>;
}
```

### 轴对齐映射

| Figma `primaryAxisAlignItems` | CSS `justify-content` |
|------------------------------|----------------------|
| `MIN` | `flex-start` |
| `CENTER` | `center` |
| `MAX` | `flex-end` |
| `SPACE_BETWEEN` | `space-between` |

| Figma `counterAxisAlignItems` | CSS `align-items` |
|------------------------------|------------------|
| `MIN` | `flex-start` |
| `CENTER` | `center` |
| `MAX` | `flex-end` |
| `BASELINE` | `baseline` |

| Figma `layoutWrap` | CSS `flex-wrap` |
|-------------------|----------------|
| `NO_WRAP` | `nowrap`（默认）|
| `WRAP` | `wrap` |

### 子节点尺寸策略

对每个子 C：

| Figma `layoutSizingHorizontal/Vertical` | CSS |
|----------------------------------------|-----|
| `FIXED` | 显式 `width` / `height`（值取自 `absoluteBoundingBox.width/height`）|
| `FILL` | 主轴：`flex: 1 0 0`；副轴：`align-self: stretch` |
| `HUG` | 不设 width/height（让内容撑起）|

若 `layoutAlign: STRETCH`（旧 API）→ 副轴 `align-self: stretch`
若 `layoutGrow > 0` → 主轴 `flex-grow: <value>`

## ABSOLUTE 档（`layoutMode: NONE`）

父节点无 auto-layout，子节点按 `absoluteBoundingBox.x/y` 绝对定位。

```css
.parent {
  position: relative;
  width: <parent.width>px;
  height: <parent.height>px;
  overflow: <clipsContent ? 'hidden' : 'visible'>;
}
.child {
  position: absolute;
  left: <child.abbox.x - parent.abbox.x>px;
  top:  <child.abbox.y - parent.abbox.y>px;
  width: <child.width>px;
  height: <child.height>px;
  transform: rotate(<child.rotation>deg);  /* 有 relativeTransform 时 */
}
```

### constraints 映射（仅在 ABSOLUTE 下相关）

子节点 `layout.constraints` 决定父容器尺寸变化时子节点如何跟随。对固定尺寸父容器此项可忽略；需要响应式时：

| `constraints.horizontal` | CSS 等价 |
|------------------------|---------|
| `MIN` | 只 `left` |
| `MAX` | 只 `right`（`right: parent.w - child.right`）|
| `CENTER` | `left: 50%; transform: translateX(-50%)` |
| `STRETCH` | `left: X; right: Y` 双向绑定 |
| `SCALE` | `left: A%; width: B%`（比例）|

### 子节点顺序陷阱

`node.children[]` 的顺序是**图层 z-order**，不是视觉顺序。若需要按视觉 x / y 顺序遍历（比如同一行靠 left 排序）：

```
visualChildren = [...children].sort((a, b) => {
  const dy = a.abbox.y - b.abbox.y;
  if (Math.abs(dy) > 1) return dy;   // 先按 y
  return a.abbox.x - b.abbox.x;       // 再按 x
})
```

**Nav logo 顺序错误**就是因为把 `children[]` 顺序当视觉顺序——实际 Figma 里 Vector 在 Text 左边（x=4）但 `childIndex: 1`。

## FLEX_INFERRED 档

Figma 自动推断某些 `layoutMode: NONE` 节点其实是"行"或"列"，存入 `layout.inferredAutoLayout`。只在**明确允许升级**时使用（见 `08-route-escalation.md`），否则保留 ABSOLUTE。

```
if layout.inferredAutoLayout AND replay.routeHint === 'DOM_INFERRED':
  按 inferredAutoLayout 的 direction/spacing/padding 走 FLEX_* 档
else:
  保留 ABSOLUTE
```

## GRID 档

`layout.gridRowCount` / `gridColumnCount` 存在时：

```css
.grid {
  display: grid;
  grid-template-columns: <gridColumnSizes 映射>;
  grid-template-rows: <gridRowSizes 映射>;
  column-gap: <gridColumnGap>px;
  row-gap: <gridRowGap>px;
}
.grid-child {
  grid-column: <gridColumnAnchorIndex+1> / span <gridColumnSpan>;
  grid-row:    <gridRowAnchorIndex+1>    / span <gridRowSpan>;
  justify-self: <gridChildHorizontalAlign 映射>;
  align-self:   <gridChildVerticalAlign 映射>;
}
```

### `gridRowSizes` / `gridColumnSizes` 映射

Figma 轨道定义是一个对象数组，每项：

| Figma type | CSS 等价 |
|-----------|---------|
| `FIXED`（value=N）| `Npx` |
| `FIT` | `fit-content` |
| `FILL`（value=N 是 fraction 权重）| `Nfr` |

## 盒模型与 stroke 对齐

| Figma `strokeAlign` | 推荐 CSS |
|---------------------|---------|
| `INSIDE` | `box-sizing: border-box` + `border-width: <strokeWeight>px` + `border-color: <stroke.color>` |
| `CENTER` | 同 INSIDE，外观近似；像素级精度需要 SVG |
| `OUTSIDE` | `outline: <strokeWeight>px solid <color>`（不占位）或外层 wrapper |

`layout.strokeTopWeight` 等单边存在时，按 `border-top-width` 独立设置。

## clipsContent

| `layout.clipsContent` | CSS |
|----------------------|-----|
| `true` | `overflow: hidden` |
| `false` | `overflow: visible` |
| 缺失 | 默认 `visible`（flex）/ 容器类型差异 |

## 自检

- [ ] 用 `layout.layoutMode` 走决策树，没目测猜"行/列"
- [ ] `layoutMode: NONE` 的 FRAME 加了 `position: relative`，子节点 `position: absolute`
- [ ] ABSOLUTE 档子节点用 `absoluteBoundingBox.x - parent.x` 算 `left`
- [ ] 需要按视觉顺序的场景，排序后再递归
- [ ] `FIXED` 子节点有显式 width/height；`FILL` 用 `flex: 1 0 0`；`HUG` 不设
- [ ] `clipsContent` 正确映射到 overflow
