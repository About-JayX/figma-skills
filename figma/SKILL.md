---
name: figma
description: >-
  Figma 高精度还原。触发条件：Figma URL、node ID、bridge/plugin 配置、
  设计稿还原、视觉 diff、Figma 驱动的 UI 变更、主题变量同步。
  bridge 优先获取 geometry/layout/fills/strokes/effects/SVG；
  MCP 补充 screenshot/assets/code-connect。
---

# Figma 高精度还原

你是 Figma 设计稿到前端代码的精确还原引擎。你的唯一数据源是 bridge 提取的 `style.*` 原始数据 + pipeline 富集的 `computedCss.*` 字段。`node.css` 仅作参考，不可作为实现依据。每个节点的每个属性都必须从 bridge 数据验证后才能写入代码。

## 命令约定

除非另有说明，本 skill 中的命令都从当前 skill 根目录（`skills/figma/`）执行。

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

## 强制流程（5 步，每步完成才能进下一步）

### Step 1 — Bridge 提取

```bash
node ./scripts/figma_pipeline.mjs "<figma-url>"
```

产出 `cache/<fileKey>/<nodeId>/bridge-agent-payload.json`（已富集 computedCss 各字段）+ `baseline/baseline.png`（A8 plugin 导出）+ `cross-validation-report.json`。

- `NO_PLUGIN_CONNECTION` → **停止**，读 `10-bridge-env.md` 排查，**禁止**静默降级到 MCP-only
- **HIGH 级**交叉校验警告必须在 Step 3 前处理（退回 `01-data-sources.md` 核对对应字段）

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

如果消费方是 React / HTML / 任何能跑 Web 的环境：

```bash
node ./scripts/generate_skeleton.mjs <cache-dir> --target react --out output/skeleton.jsx
```

产出 `output/skeleton.jsx`：完整的 React 组件，每个 Figma 节点都有对应的 JSX 元素 + 精算的 inline style + 正确的图片/SVG 引用。

agent 只需要做：
1. **重命名组件**（默认按 root.name 自动转 PascalCase；按需改）
2. **加语义标签**（`<div data-fig-name="Nav">` → `<nav>`，data-fig-id 已留作反查标记）
3. **接交互**（onClick / hover / 状态）
4. 把 generator 输出的 `RESET_CSS` + `FONTS_HREF` 接入消费方的全局样式 / `<head>`
5. 把 `cache/<key>/assets/` 复制或符号链接到消费方的 public 目录

**禁止**：再去逐节点翻译 bridge 字段、手算 CSS、改 generator 已经给的 inline style。generator 已经吃掉这些工作。

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
- [ ] 已按 `09-verification.md` 跑 scorecard，region 收敛后再做 page 级
- [ ] 验收报告列明：通过项 / 失败项 / 未验收项 / 已知偏差
- [ ] 大图（>25M 像素）未直接跑全图 scorecard
- [ ] 未把 `bridge-response.json` / 完整 `restSnapshot` 整包加载到上下文

## 环境

依赖安装、bridge 端口、插件导入、cache 产物路径全部见 `references/10-bridge-env.md`。
