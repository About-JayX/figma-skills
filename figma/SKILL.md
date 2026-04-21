---
name: figma
description: >-
  Figma 高精度还原。触发条件：任意 Figma URL、node ID、bridge/plugin 配置、
  设计稿还原、视觉 diff、Figma 驱动的 UI 变更、主题变量同步。
  bridge 优先获取 geometry/layout/fills/strokes/effects/SVG；
  MCP 补充 screenshot/assets/code-connect。
---

# Figma 高精度还原

你是 Figma 设计稿到前端代码的精确还原引擎。你的唯一数据源是 bridge 提取的 `style.*` 原始数据 + pipeline 富集的 `computedCss.*` 字段。`node.css` 仅作参考，不可作为实现依据。每个节点的每个属性都必须从 bridge 数据验证后才能写入代码。

## 命令约定

除非另有说明，本 skill 中的命令都从当前 skill 根目录（`skills/figma/`）执行。

## 通用模板约束

这个 skill 是**通用于多种设计稿**的还原模板，不绑定任何单一页面、单一 node 树、单一视觉风格。

- 所有命令里的 `<figma-url>`、`<cache-dir>`、`<output-dir>`、`<nodeId>` 都是占位符，必须替换成**当前这次任务**的真实目标
- 不要把某一次设计稿里的节点名、组件名、颜色、字号、布局层级，提升成 skill 规则
- 语义化重构时，组件边界来自**当前设计稿的结构和职责**，不要复用其他页面里碰巧成立的命名
- 输出目录、验收截图、baseline、热区分析都必须从**当前 node 对应的 cache** 推导，不能沿用上一份设计稿的产物
- 若当前设计稿的结构与既有样例差异很大，优先保留这套流程的阶段划分与验收标准，而不是硬套某个样例的组件拆法

把它理解成一个“Figma URL / node ID → bridge → codegen → refactor → verify”的通用流水线模板，而不是某一份案例的操作笔记。

## References（按读取时机排序）

| 编号 | 文件 | 什么时候读 |
|------|------|----------|
| 01 | `references/01-data-sources.md` | **写代码前**。agent-payload 字段权威表，含 `computedCss.*` 富集字段 |
| 02 | `references/02-css-reset.md` | **写代码前**。强制 CSS reset 模板，复制即用 |
| 03 | `references/03-node-to-html.md` | **写每个节点时**。确定性消费算法，七步流程 |
| 04 | `references/04-text-rendering.md` | 碰到 TEXT 节点时 |
| 05 | `references/05-layout-modes.md` | 碰到任何 FRAME / SECTION / INSTANCE 时 |
| 06 | `references/06-paint-effects.md` | 碰到 gradient / mask / shadow / blur 时 |
| 07 | `references/07-tokens-and-vars.md` | 节点有 `variables.bound` 或需要 token 同步时 |
| 08 | `references/08-route-escalation.md` | 命中 hard node 或 scorecard 不达标需要升级时 |
| 09 | `references/09-verification.md` | Step 4 验收。scorecard 唯一来源 |
| 10 | `references/10-bridge-env.md` | 遇到 bridge / plugin / cache 问题时 |

---

## 标准 Workflow（不可跳步）

当用户直接给 Figma URL / node-id 并要求“还原 / 复现 / 做 React 版”时，默认按下面 workflow 执行。这个 workflow 参考既有高保真还原流水线经验整理，目的就是**防止跳步骤导致还原性变弱**。

### Workflow 0 — 输入确认

- 输入必须先落成 `<figma-url>`、`<cache-dir>`、`<output-dir>`
- 若用户没指定输出目录，按 `output/gen-<nodeId>/` 或当前任务约定输出
- 若只是局部 node 还原，不要直接把别的历史项目产物拿来复用

### Workflow 1 — 先跑提取与机械基线

```bash
node skills/figma/scripts/figma_pipeline.mjs --auto "<figma-url>"
```

必须先拿到：
- `bridge-agent-payload.json`
- `render-ready.json`
- `baseline/baseline.png`
- 首轮 `_verify/verify-report.json` / `lint-report.json` / `scorecard*.json`
- 机械输出项目（React/Vite 或 skeleton）

**禁止跳过**：不能还没拿到 baseline 和首轮 verify，就直接手改 JSX/CSS。

### Workflow 2 — 先读诊断，再选交付模式

先读：
- `_verify/verify-report.json`
- `_verify/scorecard-heatmap.png`
- `lint-report.json`
- 必要时回 `render-ready.json` / `bridge-agent-payload.json`

然后才允许决定：
- 当前是 `DOM-first`、`Hybrid-SVG` 还是 `Visual-lock`
- 当前差异属于 layout drift、text drift 还是 hard node drift
- 是否需要 route escalation

**禁止跳过**：不能先决定“这块用 overlay / SVG lock”，再去补看 heatmap 或 diff 证据。

### Workflow 3 — 主会话定向 refactor

只在主会话里修当前输出项目：
- 保留 `className (n-<id>)` 和 `id`
- 优先做最小必要改动
- 如果是 DOM 路线，修结构 / 字体 / gap / 对齐 / 语义
- 如果是 hard-node 路线，按 route escalation 升级到 SVG / Canvas / Raster

**禁止跳过**：
- 不要把“验证没做完”的猜测直接写成最终结构
- 不要先大规模美化/抽象，再回头补 fidelity

### Workflow 4 — 每轮改动后立即复验

每次有意义的改动后都要重新跑：
- `lint_reproduction`
- scorecard / verify_loop

判断：
- 是否比上一轮更好
- 是否需要继续保持当前交付模式
- 是否需要升级 locked region / 降低锁定范围 / 拆出交互元素

**禁止跳过**：不能连做多轮结构改动却只在最后验一次。

### Workflow 5 — 最多 3 轮闭环

推荐节奏：
1. 机械基线
2. 第一轮定向修复
3. 第二轮 route / text / layout 收敛
4. 仍不过则人工判断是否进入 `Visual-lock` / `RASTER_LOCK`

超过 3 轮仍无明显收敛：
- 停止继续“凭感觉微调”
- 回到 route / screenshot / font loading / baseline 稳定性排查

### Workflow 6 — 报告时必须显式交代

- 最终交付模式
- locked regions
- SSIM / pixel diff / ΔE00 变化
- lint block / warn 数
- 还剩哪些偏差

## 跳步风险

以下跳步会明显削弱还原性：

- 跳过首轮 verify：会在没有证据的情况下误判成布局问题
- 跳过交付模式判断：会把本应 route escalation 的问题硬塞回 DOM 修
- 跳过每轮复验：会把多个变化叠在一起，失去归因
- 跳过 locked region 报告：会把 `Visual-lock` 误说成 DOM fidelity
- 跳过 lint：会遗漏结构丢节点、gap 错配、资源路径问题

**原则**：先基线，后诊断；先证据，后路由；先小改，后复验；最后才宣称“已对齐”。  

## 强制流程（5 步，每步完成才能进下一步）

### Step 1 — Bridge 提取

```bash
node ./scripts/figma_pipeline.mjs "<figma-url>"
```

产出 `cache/<fileKey>/<nodeId>/` 下：
- `bridge-agent-payload.json` —— 完整富集 payload（9MB 级），字段级权威源
- `outline.json` —— **稀疏树 sidecar（~50–400KB，对标 MCP `get_metadata`）。跨树推理 / 定位节点时先读它，不要上来就读 9MB payload**
- `baseline/baseline.png` —— A8 plugin 导出的 2x PNG
- `cross-validation-report.json` —— 交叉校验警告

处理规则：
- `NO_PLUGIN_CONNECTION` → **停止**，读 `10-bridge-env.md` 排查，**禁止**静默降级到 MCP-only
- **HIGH 级**交叉校验警告必须在 Step 3 前处理（退回 `01-data-sources.md` 核对对应字段）
- 跨树推理（筛选节点 / 定位子树 / 统计类型分布）优先用 `outline.json`；字段级下钻才回 `bridge-agent-payload.json`
- 图标/插图密集的设计，可选加 `--collapse-vector-groups` flag 让纯 vector 子树合成一个 SVG（在测试 cache 上 SSIM 反而从 0.838 ↑ 0.862）：
  ```bash
  node ./scripts/render_ready.mjs <cache-dir> --collapse-vector-groups
  ```
  折叠会写 `collapsed-vector-groups.json` 审计文件，可逆。首次开启必须验收 SSIM 不下降

### Step 2 — 节点审计

遍历 `designSnapshot.root` 所有节点，输出审计表：

```
节点ID  名称         visible  opacity  渲染决定
xxxx    播放按钮      true     0        不渲染 [OPACITY=0]
xxxx    分类标签      false    1        不渲染 [HIDDEN]
xxxx    标题         true     1        渲染
```

依据：`node.visible === false` → 不渲染；`node.style.opacity === 0` → 不渲染；`fills[].visible === false` → 该 fill 层不渲染。

### Step 3 — 写代码

#### Step 3a — 直接生成（首选，零翻译）

两条路，按消费方需求选：

**A. 完整 Vite 项目**（推荐，要跑 verify_loop 的必走）

```bash
node ./scripts/codegen_pipeline.mjs <cache-dir> <output-dir>
```

一次产出可 `npm install && npm run dev` 的 React + Vite 工程：`src/App.jsx` / `src/App.css` / `index.html` / `vite.config.js` / `package.json`。`index.html` 里**已自动注入** Google Fonts `<link>`（按 bridge 实际用到的 family + weight + italic 精确请求，无白名单）。SVG blobs 进 `public/svg/`，图片进 `src/assets/`。

**B. 单文件 React 组件**（嵌进既有项目时）

```bash
node ./scripts/generate_skeleton.mjs <cache-dir> --target react --out output/skeleton.jsx
```

产出 `output/skeleton.jsx`：单文件 React 组件，导出 `RESET_CSS` 和 `FONTS_HREF` 常量供消费方接入全局样式和 `<head>`。

agent 只需要做：
1. **重命名组件**（默认按 root.name 自动转 PascalCase；按需改）
2. **加语义标签**（`<div data-fig-name="Nav">` → `<nav>`，data-fig-id 已留作反查标记）
3. **接交互**（onClick / hover / 状态）
4. （路 B 才需要）把 `RESET_CSS` + `FONTS_HREF` 接入消费方的全局样式 / `<head>`
5. （路 B 才需要）把 `cache/<key>/assets/` 复制或符号链接到消费方的 public 目录

补充约束：
- 语义化和组件拆分要对**当前页面**成立，不能为了复用历史案例而强行抽成固定模板
- 如果当前设计稿更适合保留机械结构（例如复杂硬节点、密集 vector、一次性营销页装饰层），优先保真，再做最小语义增强
- 如果当前设计稿出现可复用模块（Card / Hero / Pricing / Footer 等），再抽象子组件；抽象来自当前树结构，不来自旧案例记忆

**禁止**：再去逐节点翻译 bridge 字段、手算 CSS、改 generator 已经给的 inline style。generator 已经吃掉这些工作。

#### Step 3a.1 — 选择交付模式

通用 Web 还原默认有三种交付模式，按**当前设计稿的交互强度与 route 信号**选择：

| 模式 | 适用场景 | 优先目标 |
|------|----------|----------|
| `DOM-first` | 普通业务页 / 设计系统页 / 交互较多、状态较多的界面 | 保留真实 DOM 结构与可维护性 |
| `Hybrid-SVG` | 局部 hard node 很重，但页面仍有真实文本、按钮、状态和语义结构 | 保留可交互 DOM，同时把高误差区域锁给 SVG/Canvas |
| `Visual-lock` | 营销页、活动页、强装饰页面，或 DOM/Hybrid 连续验证仍卡在 hard-node 阈值下 | 优先视觉一致性，接受更强的图形锁定 |

选择规则：
- 默认从 `DOM-first` 开始
- 某些子树命中 hard signal 或 scorecard 持续指向 hard node drift → 升到 `Hybrid-SVG`
- 大部分关键误差都来自 hard node，且当前页面交互很弱/很少 → 可升到 `Visual-lock`
- 一旦使用 `Hybrid-SVG` 或 `Visual-lock`，必须在验收报告里显式声明**交付模式**和**锁定区域**

锁定区域（locked region）定义：
- 某个节点 / 子树 / 页面区域的最终像素由 SVG / Canvas / Raster 提供，而不是由底下的 DOM 逐属性还原
- 锁定区域允许保留底层 `id` / `className` / 语义壳层，供定位、审计、最小交互和后续 refactor 使用

### Step 3a.2 — overlay / island 约束

如果当前方案使用 `SVG_ISLAND` / `CANVAS_ISLAND` / `RASTER_LOCK` 覆层：

- 优先锁**子树级**区域；只有当误差主要来自整页装饰层、且交互很弱时，才考虑**页面级**锁定
- 保留原始 `id` 与 `className`，不要为了锁图删掉可审计结构
- overlay 图层默认 `aria-hidden="true"`；它是视觉载体，不应抢语义
- 需要真实点击/hover/focus 的元素，必须保持在 overlay 之上，或从锁定区域里拆出去
- 如果 overlay 覆盖了整个页面，必须在报告中说明这是 `Visual-lock`，不能再把它表述成纯 DOM fidelity
- `SVG_ISLAND` 的内部几何不再按普通 flex 盒模型逐项解释；这类区域以视觉验收和 route 正确性为准

#### Step 3b — 手工 fallback（仅在 generator 不能用时）

如果消费方是非 Web 环境（iOS / SwiftUI / 小程序 / Flutter / 原生），按 `references/03-node-to-html.md` 的七步算法手工还原。

**前置**（仅 fallback）：
1. Read `02-css-reset.md` 把 reset 块复制到样式表顶部（Web 场景）
2. Read `03-node-to-html.md` 掌握七步算法
3. 根据节点类型按需 Read 04-08

**消费时优先级（硬规定，3a 和 3b 通用）**：

1. `node.computedCss.full` / `node.computedHtml` 存在 → **直接贴，不再推理**
2. `node.computedCss.<field>` 存在 → 直接映射到对应 CSS 属性
3. `node.style.*` / `node.layout.*` / `node.text.*` 原始字段（按 `01-data-sources.md` 映射）
4. `node.css.*` 仅在原始字段缺失且非「已知降级项」时参考

**禁止**：猜测、从截图推断、凭组件名假设、手算可由 pipeline 产出的 CSS（gradient / token / positioning）。

### Step 4 — 验收

**完整流程见 `09-verification.md`**。摘要：

- **region-first**：先对修改区做 `--crop + --mode region`，过了再做 page
- **大图保护**：baseline/candidate > 25M 像素禁止全图，必须 crop
- **截图规则**：candidate 必须 `--headless=new --window-size=W,H --force-device-scale-factor=2`，**禁止** `sips --cropOffset` 后处理（详见 09 「截图后处理」节）
- **诊断顺序**：SSIM 异常低（<0.7）时**先**验证截图本身（尺寸、顶部黑/白带、逐行 brightness profile），**再**怀疑 CSS / 字体 / 布局
- **大图 Read 限制**：baseline / candidate 最长边超 2000 px 时不能直接 Read 给 LLM —— pipeline 已自动产出 `<name>-preview.png` + `<name>-preview.meta.json` 同目录，读 preview，量像素时按 meta 里的 `scale` 还原
- **scorecard 命令**见 `09-verification.md`
- 阈值：page（0.98 / 0.5% / ΔE p95 1.5）、region（0.985 / 0.2% / 1.0）、hard-node（0.99 / 0.1% / 0.8）

无 baseline 不能宣称「已对齐」。scorecard 未跑 + 无视觉对照不能宣称「已验收」。

### Step 5 — Hard Gates 自查

提交代码前逐条过，有未通过回对应 Step。

## Hard Gates（违反任一条 = 还原未完成）

- [ ] Bridge 提取成功，未静默降级
- [ ] 节点审计表已生成，HIDDEN / OPACITY=0 节点未渲染
- [ ] cross-validation-report 的 HIGH 警告已处理
- [ ] **Web 场景已经跑 `generate_skeleton.mjs` 拿到骨架**（Step 3a），仅做命名/语义/交互定制
- [ ] 代码最顶部有 `02-css-reset.md` 的 reset 块（Step 3a 生成器已自动注入）
- [ ] 所有 `computedCss.full` / `computedHtml` 存在的节点直接贴，没回头手算
- [ ] 所有 `layoutMode: NONE` 的 FRAME 用了 absolute 定位，子节点按 `absoluteBoundingBox.x/y` 排序
- [ ] 所有 TEXT 的 segments ≥2 段拆了 span
- [ ] 所有 GRADIENT fill 用 `computedCss.background`
- [ ] 所有 token 绑定输出 `var(--xxx)` 而非硬编码
- [ ] hard node 已升级到 SVG / Canvas / Raster 之一（见 `08-route-escalation.md`）
- [ ] 若使用 `Hybrid-SVG` / `Visual-lock`，已声明交付模式与锁定区域
- [ ] overlay 方案下需要交互的节点未被视觉锁定遮死，或已明确列为非交互表面
- [ ] 已按 `09-verification.md` 跑 scorecard，region 收敛后再做 page 级
- [ ] 验收报告列明：通过项 / 失败项 / 未验收项 / 已知偏差
- [ ] 大图（>25M 像素）未直接跑全图 scorecard
- [ ] 未把 `bridge-response.json` / 完整 `restSnapshot` 整包加载到上下文

## 环境

依赖安装、bridge 端口、插件导入、cache 产物路径全部见 `references/10-bridge-env.md`。
