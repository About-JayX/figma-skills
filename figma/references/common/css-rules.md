# CSS 还原规则

## 目录

- 写代码前检查
- 写代码时遵守
- Web 平台能力映射

本文件只定义实现规则。详细验收阈值、done gate 和输出要求见 `./acceptance.md`。

违反任一条，不能宣称"已按 Figma 还原"。`figma_pipeline.mjs` 会自动检查标注 `[自动]` 的项。

## 写代码前检查（pipeline 输出的 HIGH 警告）

### [自动] 渐变描边降级
`style.strokes` 有 `GRADIENT_LINEAR` 等渐变类型时，`node.css` 会降级为 `border: solid`。必须用 mask-composite 或渐变背景+padding 实现。

### [自动] blur + blend 隔离
`filter: blur()` 和 `mix-blend-mode` 禁止同元素。filter 创建隔离层叠上下文，blend 目标会变。拆成父子两层：外层 blend，内层 blur。

### [自动] gradientTransform
渐变有 `gradientTransform` 时，`gradientStops[].position` 是变换前的值 ≠ 渲染位置。交叉参考 `node.css` 百分比值，同时 `fills[].opacity` 要乘入终止色 alpha。

### [自动] 旋转节点
`relativeTransform` 非单位矩阵时，`layout.width` 是原始尺寸，`absoluteBoundingBox` 是旋转后包围盒。`node.css` 的 `radial-gradient` 参数基于未旋转坐标系，不能直接用在 abs 尺寸上。渐变中心需通过矩阵映射计算。

### Figma stroke 在 fill 之上
CSS DOM 顺序靠前的元素在底层。border 层必须在 background 和 glow 之上，必要时调整 DOM 顺序或显式 z-index。

### [手动] blur 值 1:1 不除以 2
`node.css` 中 `backdrop-filter: blur(Npx)` / `filter: blur(Npx)` 的值已被 Figma getCSSAsync **除以 2**。必须用 `style.effects[].radius` 原值 1:1 映射 CSS。

- Figma 面板 `Blur: 8` = bridge `style.effects[].radius: 8` = CSS `blur(8px)`
- `node.css` 会输出 `blur(4px)`，不要用这个值

### [手动] 复用现有组件前必须验证
复用任何 icon / 插画 / 空状态等视觉组件前，必须 Read 该组件源码确认实际 SVG / 渲染内容。bridge 提供了 SVG 时以 bridge 为 ground truth 对比。不匹配时新建组件，不强行复用。

### [手动] 节点可见性审计
写代码前必须遍历所有节点检查 `visible` 和 `style.opacity`：

- `visible === false` → 不渲染
- `style.opacity === 0` → 不渲染
- `style.fills[].visible === false` → 该 fill 层不渲染

## 写代码时遵守

### 1. 位置从 bridge 数值计算，禁止目测
`left / top / size` 从 `absoluteBoundingBox`、`relativeTransform` 或 `layout.x/y` 精确计算。有旋转时用矩阵乘法换算。

### 2. effects 逐项实现
`LAYER_BLUR`、`DROP_SHADOW`、`INNER_SHADOW`、`BACKGROUND_BLUR` 不能跳过。不能 1:1 映射时写明近似方案和已知偏差。

### 3. 渐变色值禁止手动改 alpha
`style.fills/strokes` 的 RGBA 直接使用。需要模拟模糊/扩散时，通过元素尺寸和 stop 位置调整，不改原始色值。

### 4. 渐变描边必须保留
`style.strokes` 有渐变时实现必须保留。推荐：渐变背景 + padding，圆角用 mask-composite。

### 5. 中文文字 line-height 必须留余量
bridge `line-height` 值是 Figma 计算的精确值，但中文字体底部笔画在 CSS 渲染中可能被截断。`12px` 字号的 line-height 至少用 `16px`，不要直接照搬 bridge 的 `14px`。

### 6. CSS 变量 / token 替代 bridge 色值前必须确认值一致
如果用 CSS 变量或 token 替代 bridge 精确色值，必须先确认解析值与 bridge 一致。不确定时直接写死 bridge 值，并按 `../bridge/token-extraction.md` 的流程处理。

### 7. 实现后必须实际预览
在浏览器或应用页面看渲染结果。不能只看代码。

## Web 平台能力映射

| Figma 事实层 | 优先映射 |
|-------------|---------|
| auto layout / inferred | CSS Flexbox / Box Alignment / Sizing |
| grid container/child | CSS Grid / fr / fit-content() / span |
| text | CSS Fonts / Text / Inline Layout / OpenType |
| color | CSS Color / sRGB / Display-P3 / Lab / Oklab |
| mask / effects | CSS Masking / Filter Effects / Compositing / SVG filters / Canvas |
| complex vector | SVG geometry / text path / Canvas / raster fallback |
