# Replay System

## 目录

- 架构
- 采集协议
- 节点路由

## 架构

**Figma → Replay IR → node routing → hybrid replay → visual diff → route escalation**

主产物是 **Replay Bundle**，不是某种单一代码输出。HTML/React/Canvas/Flutter 都只是 adapter。

### 核心原则

- **truth-first**：任何节点先有多视图事实，再做决定。事实层来自 bridge `designSnapshot`（真源）、`node.css`（hint）、`restSnapshot`（对账）、`svgString`（hard node fallback）、MCP screenshot/assets（补充）
- **region-first**：agent 不直接面对整页，Planner 先拆成组件块 / 区域块 / hard node 块
- **verify-first**：没有 baseline、diff、阈值判定和偏差说明，不叫完成

### 主循环

1. **capture** — 抓取 live design facts
2. **normalize** — 统一成 Replay IR（设计事实与渲染决策分离）
3. **route** — 按节点能力边界决定 renderer
4. **replay** — 按区域和路由重放
5. **verify** — baseline vs 当前结果做像素/结构/感知对比
6. **escalate** — 超阈值节点自动升级渲染路径

### Replay IR 五层

- **semantic**：节点树、命名层级、组件/变体状态、文本分段、变量绑定
- **layout**：显式/推断 auto layout、sizing、grid 轨道/span/anchor、constraints、absoluteBoundingBox/absoluteRenderBounds
- **paint**：fills/strokes/effects/backgrounds、渐变 stop 级变量绑定、image/video/pattern、mask/complex stroke
- **resources**：image/video/pattern 资源、hash、导出件、svg islands
- **verification**：baseline export、区域裁片、diff 热区、路由升级记录

### Agent 角色

- **extractor**：确定性插件/工具，不是 LLM
- **planner**：拆块、定路由、标记验证需求
- **builder**：按路由规则重放每个块
- **critic**：baseline diff，决定是否升级路由

---

## 采集协议

### capture modes

- **fast mode**：可用 `skipInvisibleInstanceChildren = true`，只抓目标节点与最小邻域
- **audit mode**（高精度默认）：不依赖 skip，逐页懒加载，疑难实例补抓不可见子节点

### 必需事实层

1. **semantic**：id / type / name / visible / isMask / maskType / componentPropertyDefinitions / componentPropertyReferences / variantProperties / 变量绑定 / 文本分段
2. **layout**：显式 auto layout / inferredAutoLayout / layoutSizing / strokesIncludedInLayout / constraints / absoluteBoundingBox / absoluteRenderBounds
3. **grid**：container（rowCount/columnCount/gap/sizes）+ child（span/anchor/align）
4. **paint**：fills / strokes / backgrounds / effects / blendMode / opacity / 渐变 stop 变量 / image filters / pattern / complexStroke / variableWidthStroke
5. **text**：fontName / fontSize / fontWeight / lineHeight / letterSpacing / fills / textDecoration* / textCase / listOptions / paragraphSpacing / openTypeFeatures / hyperlink
6. **vector/hard-node**：svgString / vectorPaths / handleMirroring / booleanOperation / textPathStartData / maskType

### replay metadata

每个节点输出：`replay.routeHint` / `replay.hardSignals` / `replay.verificationTier` / `replay.requiresVisualVerification`

### source priority

- `designSnapshot` = 结构化真源
- `node.css` = hint（会降级渐变描边等）
- `restSnapshot` = reconciliation
- `svgString` = hard node fallback
- `screenshot` = verification baseline

---

## 节点路由

### route classes

| Route | 适用场景 |
|-------|---------|
| `DOM_NATIVE` | 普通 frame/group/矩形/文本/图片、设计系统稳定实例 |
| `DOM_INFERRED` | 无显式 auto layout 但 inferredAutoLayout 可信 |
| `DOM_GRID` | grid 语义明确、轨道/gap/span 事实完整 |
| `SVG_ISLAND` | mask、boolean op、复杂 vector、text path、pattern、复杂渐变、variable width stroke |
| `CANVAS_ISLAND` | progressive blur、glass/texture/noise、多重过滤合成顺序敏感 |
| `RASTER_LOCK` | 升级链路最后一级，必须记录原因 |

### hard signals（命中任一 → 不进普通 DOM）

isMask / maskType / booleanOperation / pattern fill / video paint with filters / complexStrokeProperties / variableWidthStrokeProperties / textPathStartData / 多条 vectorPaths / noise/texture/glass / progressive blur

### 升级链路

`DOM_NATIVE → DOM_INFERRED → DOM_GRID → SVG_ISLAND → CANVAS_ISLAND → RASTER_LOCK`

触发条件：
- **DOM → DOM_INFERRED**：布局/文本/渐变误差超阈值，或命中 hard signals
- **DOM_GRID → SVG_ISLAND**：轨道语义无法稳定重放，或局部 hard node 影响整体
- **SVG → CANVAS**：需要复杂像素级合成，或 SVG 路径过重仍无法通过验收
- **→ RASTER_LOCK**：必须已经过 SVG/Canvas 升级、视觉误差仍超阈值、不是核心可编辑区域

### 组件感知

看 `componentPropertyDefinitions` / `componentPropertyReferences` / `variantProperties` / 变量模式。组件契约不清楚时不要过早绑定 adapter。
