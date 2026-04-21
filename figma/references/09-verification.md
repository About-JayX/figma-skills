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

- `--window-size=<design-w>,<design-h>` 用 **CSS 像素**（设计稿原尺寸，不预乘 DPR）
- `--force-device-scale-factor=2` 把输出栅格化到 2x（产出 PNG 自动是 `2*W × 2*H`）
- `--headless=new`（**必须**用新模式，旧 `--headless` 废弃且行为不一致）
- `--virtual-time-budget=10000` 让 Google Fonts 加载完再截图
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

### ⚠ 截图后处理：禁用 sips crop

`--headless=new` 输出的 PNG 已经是精确的 `W*DPR × H*DPR`，**没有**任何浏览器 chrome overhead，**不需要**任何 post-crop。

历史上 `verify_loop.mjs` 试图加 `chromeVPad` 然后用 `sips -c H W --cropOffset -90 0` 锚顶部，结果是：sips 的负 Y 偏移**不是**"锚顶部裁剪"，而是把整张图下移 90 行 + 顶部填黑边。每张 candidate 顶部被强行注入 90 px 黑色 → SSIM 永远卡在 0.48 左右无法收敛（错误归因于布局/字体问题，浪费多轮迭代）。

**规则**：
- 直接 `--window-size=W,H`（设计稿尺寸），不加任何 padding
- **不要**用 `sips --cropOffset` 后处理 candidate（如果非要 crop，用 PIL `image.crop((x0,y0,x1,y1))` 或 `sips --cropToHeightWidth` + 严格验证输出像素和原图一致）
- 校验方法：`python3 -c "from PIL import Image; print(Image.open('candidate.png').size)"` 必须等于 `(W*2, H*2)`

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
- **plan diff**：当前 route / node signals / size mismatch / hard node / delivery mode / locked regions → **决定修复动作**

## SSIM 异常低（<0.7）的诊断顺序

SSIM 数值反常低（baseline/candidate 视觉看起来接近，但分数<0.7 / pixel diff>30%）时，**严禁**先怀疑 CSS / 字体 / 布局。按下面顺序排除截图本身的问题：

1. **截图尺寸是否 = 设计尺寸 × DPR**：`PIL.Image.open(candidate).size == (W*2, H*2)`，不等于 → 截图流程有 bug
2. **顶部/底部是否有非预期黑/白带**：扫描 `candidate[y].mean()` 在 y=0..200，与 baseline 比对。任何一边在前 100 行突然变 0 或 255 → 99% 是 crop / padding bug
3. **逐行 brightness profile 大致重合**：用 `python3 -c "from PIL import Image; import numpy as np; a=np.array(Image.open(p)); print([a[y].mean() for y in range(0,H*2,20)])"` 对两图各打一遍，大体走势必须一致
4. **抽样不能只取 3 个点**：装饰性元素（齿状 / 网格 / 透明 overlay）的间隙位置容易被采样命中，得出"baseline 是白的"假象。最少要打 row-by-row brightness 而不是几个 pixel
5. **raw screenshot 直接看一眼**：跑一次不带任何 post-crop 的 raw chrome 截图，PIL 读取看顶部 200 行，确认没有黑边

只有以上 5 点都过了，才可以怀疑 CSS / 字体 / 布局。

**反例**：曾经一个项目花了大半个会话依次怀疑了"字体没加载"、"section separator SVG 几何错"、"flex layout 偏移"，最后发现是 sips post-crop 在每张 candidate 顶部注入了 90 行黑色。诊断顺序错 → 浪费多轮 fix。

## 修复 plan 规则

| diff 类型 | 动作 |
|----------|------|
| size mismatch | `ENFORCE_ABSOLUTE_BOUNDS` / 升 `DOM_INFERRED` |
| layout drift | `FIX_LAYOUT_METRICS` / 升级路由 |
| color drift | `SYNC_COLOR_AND_EFFECTS` / 固定 colorProfile |
| hard node drift | `FORCE_PRECISE_VECTOR_EXPORT` / 升级 SVG→CANVAS→RASTER |
| text drift | `FIX_TEXT_METRICS` / 检查 font loading / 换行 / baseline / OpenType |
| interaction hidden by overlay | 缩小 locked region / 把交互节点抬到 overlay 上层 / 从 `Visual-lock` 降回 `Hybrid-SVG` |

## 交付模式与锁定区域

验收时必须区分这次交付是哪一种：

| 交付模式 | 说明 |
|----------|------|
| `DOM-first` | 最终像素主要来自 DOM/CSS，还原目标偏向真实结构 |
| `Hybrid-SVG` | 局部 locked region 由 SVG/Canvas/Raster 提供，其余区域仍是 DOM |
| `Visual-lock` | 大面积 locked region，甚至 page-level lock；优先视觉一致性 |

locked region 指：
- 最终像素由 SVG / Canvas / Raster 覆层提供的节点、子树或页面区域
- 它们不应在报告里继续被描述成“普通 DOM fidelity 已通过”的区域

如果项目使用了 `Hybrid-SVG` 或 `Visual-lock`：
- report / summary / manifest 必须写出交付模式
- 必须列出 locked regions（至少列 nodeId / 区域名 / route / 原因）
- 必须说明这些区域里的交互是否仍然真实可用，还是仅保留审计壳层

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
- [ ] 若使用 `Hybrid-SVG` / `Visual-lock`，交付模式与 locked regions 已记录
- [ ] 最终 bundle 已打包
- [ ] 结果说明中已列出：通过项 / 失败项 / 未验收项 / 已知偏差

## 最终输出格式（交付给用户）

- 对照源（baseline 来源 + candidate 来源）
- 交付模式（`DOM-first` / `Hybrid-SVG` / `Visual-lock`）
- 锁定区域（locked regions）与升级理由
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
