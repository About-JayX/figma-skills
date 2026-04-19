# 09 — Verification：scorecard / manifest / done gate

本文是**详细验收唯一来源**。SKILL.md 的 Step 4 指到本文。

## 精度指标

### 必需

- pixel diff ratio
- SSIM
- DeltaE00（p50 / p95 / max）
- 文本换行一致性
- 路由升级记录

### 阈值档

| 档 | SSIM | pixel_diff | ΔE00 p95 | ΔE00 max |
|----|------|-----------|---------|---------|
| page | ≥ 0.98 | ≤ 0.5% | ≤ 1.5 | ≤ 3.0 |
| region | ≥ 0.985 | ≤ 0.2% | ≤ 1.0 | ≤ 2.0 |
| hard-node | ≥ 0.99 | ≤ 0.1% | ≤ 0.8 | ≤ 1.5 |
| text | 关键文本换行一致 | 基线偏移 ≤ 1px | 文本宽度误差 ≤ 1% | |

不允许静默误路由；超阈值节点必须升级或显式豁免。

## 性能 Hard Gate（违反 = 禁止继续验收）

1. **region-first**：先对修改区域做 `--crop` + `--mode region`，region 收敛后才允许 page 级全图
2. **大图保护**：任一 baseline / candidate 超过 25M 像素（例 2560×10000）时**禁止**直接全图 scorecard，必须 `--crop`
3. **early-exit**：`pixel_diff_ratio` 远超阈值时加 `--early-exit` 跳过 SSIM/ΔE00 全量计算
4. **并发限制**：大图验收 / rerender / baseline 生成禁止多 entry 并行
5. **大对象读取限制**：默认只读 `bridge-agent-payload.json` / `cross-validation-report.json` / `merge-summary.md`；除排查具体字段 bug，禁止整包加载 `bridge-response.json` 或完整 `restSnapshot`

## baseline 来源

按优先级：

1. **plugin exportAsync PNG**（A8）：pipeline 自动产出 `cache/.../baseline/baseline.png`（2x scale）。FRAME/SECTION/COMPONENT/INSTANCE/GROUP 都走这个
2. **bridge SVG → rsvg-convert**：节点有 `svgString` 时的降级路径，`rsvg-convert -z 2`
3. **MCP screenshot**：上面都不可用时的补充来源
4. **手动 Figma 导出**：最后兜底

## 渲染 candidate

用 headless Chrome 截页面，确保：

- `--window-size` 与 baseline 同尺寸（1280 设计稿 = 1280×<height>；baseline 2x = 2560×<2h>）
- `--force-device-scale-factor=2` 匹配 baseline 2x
- `--virtual-time-budget=10000` 让 Google Fonts 加载
- `--hide-scrollbars`

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 \
  --virtual-time-budget=10000 \
  --screenshot=./output/render-2x.png \
  --window-size=<design-w>,<design-h> \
  "http://localhost:<port>/index.html"
```

## scorecard 命令

```bash
# region-first（推荐，先跑修改 section）
python3 ./scripts/fidelity_scorecard.py \
  --baseline <baseline.png> --candidate <render.png> \
  --mode region \
  --crop 0,<section_y>,<width>,<section_height> \
  --report ./output/sc-<section>.json \
  --heatmap ./output/heatmap-<section>.png

# 迭代调试加 early-exit
python3 ./scripts/fidelity_scorecard.py \
  --baseline <baseline.png> --candidate <render.png> \
  --mode region --crop ... --early-exit

# region 收敛后再跑 page
python3 ./scripts/fidelity_scorecard.py \
  --baseline <baseline.png> --candidate <render.png> \
  --mode page --max-pixels 30000000
```

关键 flag：

| flag | 含义 |
|------|------|
| `--mode` | page / region / hard-node（决定阈值档）|
| `--crop x,y,w,h` | 在两图裁切后比对（region 必填）|
| `--early-exit` | pixel_diff 远超阈值时跳过 SSIM/ΔE |
| `--max-pixels N` | 超过 N 像素禁止跑全图（默认 25M）|
| `--lpips` | 启用 LPIPS 指标（可选，需 GPU）|
| `--fail-on-thresholds` | 任一阈值未过 → 退出码 1（CI 用）|

算法加速（已内置）：

- C1 两阶段 ΔE76 → ΔE00：高相似度时自动走 fast path，p95 / max 不变
- C3 Lab 缓存：同 baseline 二次跑 mmap 加载，约 0.1s 开销
- 全图 2560×5814 大约 3-5s 内跑完

## acceptance manifest

多 entry 验收时用 manifest 驱动：

```json
{
  "version": 1,
  "task": { "name": "reproduce-desktop-20-532" },
  "entries": [{
    "id": "hero-headline",
    "mode": "region",
    "surface": "page",
    "baseline": "baseline.png",
    "candidate": "render-2x.png",
    "crop": "0,0,2560,498",
    "route": "DOM_NATIVE",
    "nodeId": "20:533",
    "signals": { "hasGradientText": true }
  }]
}
```

跑 acceptance pipeline：

```bash
python3 ./scripts/acceptance_pipeline.py \
  --manifest acceptance-manifest.json \
  --render-plan render.plan.json \
  --apply-route-escalation \
  --max-iterations 3 \
  --workers 2
```

`--workers N`：并行 scorecard entry（每个 worker 约 1.5GB RAM，按内存定）。

## 三类 diff

- **render diff**：pixel diff ratio / heatmap / diff bounds → **定位**差异
- **perceptual diff**：SSIM / ΔE00 / 可选 LPIPS → **判阈值**
- **plan diff**：当前 route / node signals / size mismatch / hard node → **决定修复动作**

## 修复 plan 规则

| diff 类型 | 动作 |
|----------|------|
| size mismatch | `ENFORCE_ABSOLUTE_BOUNDS` / 升 `DOM_INFERRED` |
| layout drift | `FIX_LAYOUT_METRICS` / 升级路由 |
| color drift | `SYNC_COLOR_AND_EFFECTS` / 固定 colorProfile |
| hard node drift | `FORCE_PRECISE_VECTOR_EXPORT` / 升级 SVG→CANVAS→RASTER |
| text drift | `FIX_TEXT_METRICS` / 检查 font loading / 换行 / baseline / OpenType |

## 输出物

每次验收产出：

- `acceptance-manifest.json`
- `acceptance.plan.json`
- `acceptance.summary.md`
- `diff-report.json`
- `diagnostics.json`
- `baseline/` / `candidate/` / `heatmaps/`
- 可选打包 `*.zip`

## Done Gate（最终闸）

- [ ] manifest 完整，所有关键 entry 已跑完 scorecard
- [ ] 失败 entry 已生成 action plan，可升级 route 已升级
- [ ] rerender loop 已执行到收敛或达上限（3 轮）
- [ ] 最终 bundle 已打包
- [ ] 结果说明中已列出：通过项 / 失败项 / 未验收项 / 已知偏差

## 最终输出格式（交付给用户）

- 对照源（baseline 来源 + candidate 来源）
- 已验收表面
- 已检查维度（6 维：geometry / text / visual / states / route / diff）
- 阈值结果：通过项 + 失败项
- 未验收项
- 已知偏差

**没有 baseline 对照 → 不能宣称"已对齐"。没有显式列出已检查项和偏差 → 不能宣称"已验收"。**

## 人工介入场景

- 升级到 `RASTER_LOCK` 仍不通过
- 缺字体或运行时能力
- baseline 不稳定（动画 / 实时数据 / 动态内容）
- 强交互依赖

manual review 时在 plan 中保留 `MANUAL_REVIEW` 标记，不做静默降级。

## 固定验收环境

- 浏览器版本 + OS
- 字体版本（WOFF2 指纹）
- 截图尺寸 + DPR
- 颜色空间（sRGB）
- 避开动画 / 光标 / 时间依赖内容

## 六维度验收清单（作为检查项）

| 维度 | 重点 |
|------|------|
| geometry & layout | 容器宽高 / padding / gap / margin / 对齐 / border radius / border 宽度颜色 / icon 尺寸点击区 / 定位锚点 / absoluteRenderBounds / grid 轨道 gap span anchor |
| text & hierarchy | font family / size / weight / line height / 文案层级截断 / 数字英文中文混排 / 关键文本换行 / 基线偏移 / 列表段落缩进 / 下划线装饰线 |
| visual layer | 前景背景色 / 描边分割线 / 渐变 stop 位置 / 阴影模糊遮罩 / pattern / 透明度 / 图片裁切 object-fit / glass noise texture progressive blur |
| states & behavior | hover / active / disabled / 展示隐藏条件 / 换行截断溢出 / 异步数据前后布局跳变 / 组件 prop / variant / variable mode |
| route & renderer | hard node 是否正确识别 / 当前 route 是否合理 / 误路由 / 高误差节点是否已升级 |
| diff evidence | pixel diff ratio / SSIM / ΔE00 (p95 + max) / baseline 来源 / 可选 LPIPS |
