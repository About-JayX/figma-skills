# 验收

## 目录

- 验收清单
- 精度指标
- 自动验收流程
- done gate
- 最终输出要求

本文件是详细验收的唯一来源。本文件中的命令默认从当前 skill 根目录执行。

## 验收清单（6 维度）

### 1. geometry & layout
容器宽高 / padding / gap / margin / 对齐 / border radius / border 宽度颜色 / icon 尺寸与点击区 / 定位锚点 / absoluteRenderBounds / grid 轨道 gap span anchor

### 2. text & hierarchy
font family / size / weight / line height / 文案层级截断 / 数字英文中文混排 / 关键文本换行 / 基线偏移 / 列表段落缩进 / 下划线装饰线

### 3. visual layer
前景色背景色 / 描边色分割线 / 渐变 stop 位置 / 阴影模糊遮罩 / pattern / 透明度 / 图片裁切 object-fit / glass noise texture progressive blur

### 4. states & behavior
hover / active / disabled / 展示隐藏条件 / 换行截断溢出 / 异步数据前后布局跳变 / 组件 prop variant variable mode

### 5. route & renderer
hard node 是否正确识别 / 当前 route 是否合理 / 是否存在误路由 / 高误差节点是否已升级

### 6. diff evidence
pixel diff ratio / SSIM / DeltaE00（p95 + max）/ baseline 与 candidate 来源 / 可选 LPIPS

## css vs style 交叉校验

`node.css` 已知降级：渐变描边 → solid、复合 effects 省略、复杂 blend 丢失。验收 paint / border / effect 时必须交叉校验 `style.strokes` / `style.fills` / `style.effects` 原始数据。

---

## 精度指标

### 必需指标

- pixel diff ratio
- SSIM
- DeltaE00（至少 p95 和 max）
- 文本换行一致性
- 路由升级记录

### 阈值

| 级别 | SSIM | pixel diff | DeltaE00 p95 | DeltaE00 max |
|------|------|-----------|-------------|-------------|
| page | ≥ 0.98 | ≤ 0.5% | ≤ 1.5 | ≤ 3.0 |
| region | ≥ 0.985 | ≤ 0.2% | ≤ 1.0 | ≤ 2.0 |
| hard-node | 不允许静默误路由 | 超阈值必须升级或豁免 | | |
| text | 关键文本换行一致 | 基线偏移 ≤ 1px | 文本宽度误差 ≤ 1% | |

### baseline workflow

1. Figma 导出 baseline（bridge SVG → `rsvg-convert -z 2` 或 MCP screenshot）
2. 渲染 replay 结果
3. 生成页面 / 区域级截图
4. 对差异热点生成 heatmap
5. 超阈值区域升级路由
6. 复测并记录最终 route

### 固定环境

浏览器版本 / OS 字体版本 / 截图尺寸 DPR / 颜色空间 / 动画光标时间依赖内容

---

## 性能 Hard Gate（违反 = 禁止继续验收）

1. **region-first**: 必须先对修改区域做 `--crop` + `--mode region` 验收；只有 region 收敛后才允许 page 级全图验证
2. **大图保护**: 任一 baseline/candidate 超过 25M 像素（如 2560×10000）时，**禁止**直接跑全图 scorecard，必须先 `--crop` 裁到目标 section
3. **early-exit**: 当 pixel_diff_ratio 远超阈值时，必须加 `--early-exit` 跳过 SSIM/DeltaE00 全量计算；先缩小区域再做精细验收
4. **并发限制**: 大图验收、rerender、baseline 生成禁止多 entry 并行；单次只允许一个重型验收任务运行
5. **大对象读取限制**: 默认只读 `bridge-agent-payload.json`、`cross-validation-report.json`、`merge-summary.md`；除非排查具体字段 bug，禁止把 `bridge-response.json` 或完整 `restSnapshot` 整包加载到上下文

---

## 自动验收流程

**capture baseline → capture candidate → build manifest → run scorecard → generate plan → patch render plan → rerender failed → rerun → package bundle**

### 三类 diff

- **render diff**：pixel diff ratio / heatmap / diff bounds → 定位差异
- **perceptual diff**：SSIM / DeltaE00 / 可选 LPIPS → 判阈值
- **plan diff**：当前 route / node signals / size mismatch / hard node signal → 决定修复动作

### acceptance manifest 结构

```json
{
  "version": 1,
  "task": { "name": "..." },
  "entries": [{
    "id": "region-id",
    "mode": "region",
    "surface": "target-surface",
    "baseline": "baseline/xxx.png",
    "candidate": "candidate/xxx.png",
    "route": "DOM_NATIVE",
    "nodeId": "1:2",
    "signals": { "hasGrid": true }
  }]
}
```

### plan 生成规则

- **size mismatch** → ENFORCE_ABSOLUTE_BOUNDS / DOM_NATIVE→DOM_INFERRED
- **layout drift** → FIX_LAYOUT_METRICS / 升级路由
- **color drift** → SYNC_COLOR_AND_EFFECTS / 固定 colorProfile
- **hard node drift** → FORCE_PRECISE_VECTOR_EXPORT / 升级到 SVG→CANVAS→RASTER
- **text drift** → FIX_TEXT_METRICS / 检查 font loading 换行 baseline OpenType

### 执行命令

```bash
python3 ./scripts/acceptance_pipeline.py \
  --manifest acceptance-manifest.json \
  --render-plan render.plan.json \
  --apply-route-escalation \
  --max-iterations 3
```

### 输出物

`acceptance-manifest.json` / `acceptance.plan.json` / `acceptance.summary.md` / `diff-report.json` / `diagnostics.json` / `baseline/` / `candidate/` / `heatmaps/` / `*.zip`

### done gate

- manifest 完整，所有关键 entry 已跑完 scorecard
- 失败 entry 已生成 action plan，可升级 route 已升级
- rerender loop 已执行到收敛或达上限
- 最终 bundle 已打包
- 结果说明中已列出：通过项、失败项、未验收项、已知偏差

### 人工介入场景

升级到 `RASTER_LOCK` 仍不通过 / 缺字体或运行时能力 / baseline 不稳定 / 依赖强交互或实时数据。人工介入时在 plan 中保留 `MANUAL_REVIEW`。

---

## 最终输出要求

- 对照源：使用了哪个 node / baseline
- 已验收表面
- 已检查维度
- 阈值结果：通过项与失败项
- 未验收项
- 已知偏差

**没有 baseline 对照不能宣称"已对齐"。没有显式说明已检查项和偏差不能宣称"已验收"。**
