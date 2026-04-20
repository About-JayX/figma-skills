# Figma 回归测试样本库

存放多种风格的 Figma 设计稿作为 emit_css / render_ready / lint 等 pipeline 脚本的回归测试基准。

## 目录约定

```
test_corpus/
├── README.md                       ← 本文件
├── marketing-long-page/            ← 营销长页（图多）
│   ├── spec.json                   ← metadata（url, node-id, baseline SSIM floor 等）
│   ├── cache/                      ← bridge extract 的完整快照
│   └── expected/                   ← 锁定的 render-ready.json / mechanical SSIM
├── dashboard-dense/                ← 表单 + 表格密集
├── component-library/              ← 设计系统（多 INSTANCE / variants）
├── icon-gallery/                   ← 图标密集（多 VECTOR）
└── long-article/                   ← 长段落文章型
```

## 每份样本应覆盖的 Figma 特性

| 目录 | 需要覆盖的场景 |
|---|---|
| marketing-long-page | layoutWrap, 多 image fill, flex-wrap grid |
| dashboard-dense | absolute-positioned tooltips, 表格 border, form input |
| component-library | COMPONENT INSTANCE variants, boolean operations, shared tokens |
| icon-gallery | 100+ VECTOR, 不同 strokeAlign, fill 色值分布 |
| long-article | 多段 TEXT with line wrap, line-height 变体, font-family 混排 |

## 每份样本的 spec.json 示例

```json
{
  "label": "marketing-long-page",
  "figmaUrl": "https://www.figma.com/design/XXX?node-id=N%3AM",
  "nodeId": "1:118",
  "description": "Area landing page · 233 nodes · 11 images · 233 SVG blobs",
  "capturedAt": "2026-04-20",
  "baselineSsimFloor": {
    "mechanical": 0.8200,
    "after_opus_refactor": 0.9300
  },
  "knownPatterns": [
    "layoutWrap:WRAP on product grid",
    "layoutMode:NONE on iPad component",
    "per-side stroke dividers on list items"
  ]
}
```

`baselineSsimFloor` 是**这份样本当前的 SSIM 水位**。回归脚本会对比本次跑出的 SSIM ≥ floor - 0.002，低于阈值就标红（可能是 emit_css 改动引入了退步）。

## 如何添加一份新样本

1. 在 Figma 选中目标 node，把 URL 复制出来
2. 跑一次提取到临时 cache：
   ```bash
   node skills/figma/scripts/figma_pipeline.mjs --auto "<url>"
   ```
3. 确认 SSIM / pixel_diff 符合预期后：
   ```bash
   node skills/figma/scripts/ingest_corpus_sample.mjs \
     --source-cache skills/figma/cache/<file>/<node> \
     --label <descriptive-name>
   ```
   这会把 cache 复制到 `test_corpus/<label>/cache/`，抽取当前 SSIM 作为 floor 写入 `spec.json`。
4. commit 样本目录（排除 `node_modules`）

## 跑回归

```bash
npm run regression:corpus
```

对所有样本并行跑 codegen + verify，对比每份的 SSIM 是否 ≥ floor。任何一份 SSIM 跌破阈值 → exit 1，CI 失败。

## 为什么不用 git LFS

样本目录大（每份 cache 几 MB 到几百 MB）。已加入 `.gitignore` 的 `test_corpus/*/cache/` 子路径；只 commit `spec.json` 和 `README.md`。样本数据需要**开发者之间通过其他方式同步**（云盘 / S3 / 内部共享存储）。
