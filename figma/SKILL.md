---
name: figma
description: >-
  Figma 高精度还原。触发条件：Figma URL、node ID、bridge/plugin 配置、
  设计稿还原、视觉 diff、Figma 驱动的 UI 变更、主题变量同步。
  bridge 优先获取 geometry/layout/fills/strokes/effects/SVG；
  MCP 补充 screenshot/assets/code-connect。
---

# Figma 高精度还原

你是 Figma 设计稿到前端代码的精确还原引擎。你的唯一数据源是 bridge 提取的 `style.*` 原始数据。`node.css` 仅作参考，不可作为实现依据。每个节点的每个属性都必须从 bridge 数据验证后才能写入代码。

## 命令约定

除非另有说明，本 skill 中的命令都从当前 skill 根目录执行。

## 强制流程（每步必须完成才能进入下一步）

### Step 1: Bridge 提取

在当前 skill 根目录执行：

```bash
node ./scripts/figma_pipeline.mjs "<figma-url>"
```

- `NO_PLUGIN_CONNECTION` → **停止**，告知用户启动插件，**禁止静默降级到 MCP-only**
- 输出 `cross-validation-report.json`，**HIGH 级警告必须在 Step 3 前处理**
- 遇到插件导入、bridge 端口或依赖问题时，Read `./references/bridge/setup.md`

### Step 2: 节点审计（强制）

**写代码前必须完成。** 遍历 bridge `designSnapshot.root` 所有节点，逐个检查：

```
对每个节点检查（visible 在节点根属性，opacity 在 style 下）：
1. node.visible === false → 不渲染，标注 [HIDDEN]
2. node.style.opacity === 0 → 不渲染，标注 [OPACITY=0]
3. node.style.fills[].visible === false → 该 fill 不渲染
4. node.style.strokes[].visible === false → 该 stroke 不渲染
```

**输出节点审计表**（在实现前展示给用户确认）：
```
节点ID  名称         visible  opacity  渲染决定
xxxx    播放按钮      true     0        不渲染 [OPACITY=0]
xxxx    分类标签      false    1        不渲染 [HIDDEN]
xxxx    标题         true     1        渲染
```

### Step 3: 写代码

开始写代码前先按条件读取 reference：

- **必读：** `./references/common/css-rules.md`。这是 CSS/bridge 映射规则来源；未读取就开始写代码视为违规。
- **遇到 hard node、route escalation、DOM/SVG/Canvas 选择时：** Read `./references/common/replay-system.md`
- **需要查本地脚本、cache 产物和产物结构时：** Read `./references/bridge/workflow.md`
- **要把 bridge 色值替换成消费方代码库的 CSS 变量或同步 token 时：** Read `./references/bridge/token-extraction.md`

#### node.css 可信 vs 不可信

**可信（可直接用 node.css 值）：** `font-size`、`font-weight`、`color`（纯色）、`width`、`height`、`border-radius`（无渐变）、`line-height`、`padding`、`gap`

**不可信（必须从 style.* 取值）：**

| 属性 | node.css 问题 | 取值来源 |
|------|-------------|---------|
| `blur()` | **被除以 2** | `style.effects[].radius` 原值 1:1 |
| `border`（渐变） | 降级为 solid | `style.strokes[]` gradientStops |
| `background`（渐变） | stop 位置不准 / transform 漏算 | **`node.computedCss.background`**（pipeline 已算好），无此字段时从 `style.fills[]` 手算 |
| `radial-gradient`（旋转节点） | 基于未旋转坐标系 | `node.computedCss.background` 或 `absoluteBoundingBox` + 矩阵映射 |
| stroke z-order | 无法表达 | DOM 顺序：stroke 层在 fill/glow 之上 |

#### 节点到 HTML 映射规则（强制）

**每个 bridge 节点必须有对应 HTML 元素，不得跳过任何中间 FRAME。** 即使只传递 padding/gap 的包装层也必须保留。

##### Layout 属性映射（无 node.css 的节点必须用 layout 字段构建）

| bridge 字段 | CSS 映射 |
|-------------|---------|
| `layoutMode: VERTICAL` | `display: flex; flex-direction: column` |
| `layoutMode: HORIZONTAL` | `display: flex; flex-direction: row` |
| `itemSpacing` | `gap` |
| `paddingTop/Right/Bottom/Left` | `padding` |
| `layoutSizingHorizontal: FILL` | `align-self: stretch` 或 `flex: 1 0 0` |
| `layoutSizingHorizontal: FIXED` | 显式 `width` |
| `layoutSizingHorizontal: HUG` | `width: auto` |
| `layoutSizingVertical: FIXED` | 显式 `height` |
| `layoutSizingVertical: HUG` | 不设高度（auto） |
| `clipsContent: true` | `overflow: hidden` |
| `clipsContent: false` | `overflow: visible` |

##### 图片填充映射（严格）

| bridge scaleMode | CSS 映射 |
|-----------------|---------|
| `FILL` | `background-size: cover` 或 `object-fit: cover` |
| `FIT` | `background-size: contain` |
| `CROP` | `background-size: 100% 100%` |

- `imageTransform` 非单位矩阵时必须转为 CSS transform
- 图片路径指向 `assets/{imageHash}.{format}`
- `node.css.background` 中 `url(<path-to-image>)` 替换为实际路径

##### SVG/Vector 节点（禁止占位符）

- VECTOR/BOOLEAN_OPERATION 必须用 `node.vector.fillGeometry[].path` 生成 inline SVG
- fill 颜色从 `node.css.fill` 或 `node.style.fills` 取
- **禁止使用占位符、简化路径或从外部猜测 SVG**

##### 绝对定位节点

- `node.css.position: absolute` 的节点保留绝对定位
- left/top 值从 css 取，父容器加 `position: relative`

#### 写代码检查清单（逐项执行）

1. **不可信属性从 style.* 取值，可信属性可用 node.css** — 不猜测、不从截图推断、不凭组件名假设
1a. **渐变 background 强制用 `node.computedCss.background`**（pipeline 生成，含 gradientTransform 精算） — 节点存在该字段时不许手算或降级为 `node.css.background`
1b. **Token 绑定强制输出 CSS 变量引用** — 节点若有 `node.computedCss.tokens[<css-prop>]`，CSS 该属性必须写 `var(<cssVar>)` 而非硬编码值。`variables-substitution-map.json` 提供多 mode 解析值；`inferred` 绑定仅参考，不强转。详见 `./references/bridge/token-extraction.md`
2. **blur 值 1:1** — `style.effects[].radius: N` → CSS `blur(Npx)`，不用 node.css 的 /2 值
3. **filter + blend-mode 禁止同元素** — 拆父子层
4. **渐变色值禁止改 alpha**
5. **复用组件前必须 Read 源码** — 对比 bridge SVG，不匹配则新建
6. **CSS 变量替代色值前** — Read 变量定义确认值一致，否则写死 bridge 值
7. **中文 12px 字号** — line-height 至少 16px（+2~4px 防截断）
8. **物料组件默认透明背景**
9. **富文本必须用 segment 链** — TEXT 节点 `text.segments[]` 有 ≥2 段异样样式时，逐段 `<span>`（或框架等价）渲染，不得仅按第一段整段渲染。详见 `./references/common/css-rules.md`「Styled text segments」。
10. **层层偏差优先使用 `absoluteBoundingBox.width/height`** — 嵌套 FILL / stroke 场景出现 1-2px 误差时以 `absoluteBoundingBox` 为事实。`box-sizing: border-box` + `padding` + `border-width` 覆盖常规场景，`strokeAlign: INSIDE/CENTER/OUTSIDE` 见 css-rules「布局盒」。

### Step 4: 验收（强制）

**实现完成后必须执行，不可跳过。**

#### 性能 Hard Gate（违反 = 禁止继续验收）

1. **region-first**: 必须先对修改区域做 `--crop` + `--mode region` 验收；只有 region 收敛后才允许 page 级全图验证
2. **大图保护**: 任一 baseline/candidate 超过 25M 像素（如 2560×10000）时，**禁止**直接跑全图 scorecard，必须先 `--crop` 裁到目标 section
3. **early-exit**: 当 pixel_diff_ratio 远超阈值时，必须加 `--early-exit` 跳过 SSIM/DeltaE00 全量计算；先缩小区域再做精细验收
4. **并发限制**: 大图验收、rerender、baseline 生成禁止多 entry 并行；单次只允许一个重型验收任务运行
5. **大对象读取限制**: 默认只读 `bridge-agent-payload.json`、`cross-validation-report.json`、`merge-summary.md`；除非排查具体字段 bug，禁止把 `bridge-response.json` 或完整 `restSnapshot` 整包加载到上下文

#### 验收命令

在当前 skill 根目录执行：

```bash
# region-first: 先验收修改的 section（推荐）
python3 ./scripts/fidelity_scorecard.py \
  --baseline <baseline.png> \
  --candidate <截图> --mode region \
  --crop 0,<section_y>,<width>,<section_height>

# 迭代调试时加 early-exit
python3 ./scripts/fidelity_scorecard.py \
  --baseline <baseline.png> \
  --candidate <截图> --mode region \
  --crop 0,<section_y>,<width>,<section_height> --early-exit

# region 收敛后再跑 page 级（可选）
python3 ./scripts/fidelity_scorecard.py \
  --baseline <baseline.png> \
  --candidate <截图> --mode page
```

如果没有 baseline（pipeline 对 GROUP 类型节点不生成），用 MCP screenshot 作为视觉对照，并说明未走自动 scorecard 的原因。无任何对照时不能宣称"已对齐"。

详细阈值、rerender loop、输出格式和最终 done gate 见 `./references/common/acceptance.md`。这是详细验收的唯一来源。

### Step 5: Hard Gates 自查

**提交代码前逐条过检查清单。** 有任何一条未通过，回到对应 Step 修复。

## Hard Gates（违反任一条 = 还原未完成）

- [ ] Bridge 提取成功，未静默降级
- [ ] 节点审计表已生成，HIDDEN/OPACITY=0 节点未渲染
- [ ] cross-validation-report HIGH 警告已处理
- [ ] 遇到 hard node 或升级路由时，已 Read `./references/common/replay-system.md`
- [ ] 如有 token 替代或主题同步，已 Read `./references/bridge/token-extraction.md`
- [ ] 已按 `./references/common/acceptance.md` 跑完 scorecard / done gate，并说明通过项、失败项、未验收项、已知偏差
- [ ] 验收走 region-first 顺序：先 crop + region 收敛，再可选 page 级验证
- [ ] 大图（>25M 像素）未直接跑全图 scorecard，已使用 --crop
- [ ] 未把 bridge-response.json / restSnapshot 整包加载到上下文
- [ ] 如需定位 cache、merge 产物或脚本入口，已 Read `./references/bridge/workflow.md`

## References

- `./references/common/css-rules.md`：实现前必读。只包含 CSS/bridge 映射规则，不承担详细验收职责。
- `./references/common/replay-system.md`：遇到 route selection、hard signal、升级链路时读取。
- `./references/common/acceptance.md`：详细验收唯一来源，包含阈值、manifest、rerender loop 和最终输出要求。
- `./references/bridge/workflow.md`：本地脚本速查、cache 产物、bridge 工作流。
- `./references/bridge/setup.md`：bridge / ws_defs 插件安装、依赖和环境变量。
- `./references/bridge/token-extraction.md`：变量同步、token 替代和 merge 优先级。

## 环境

依赖安装、bridge 端口和插件导入见 `./references/bridge/setup.md`。
