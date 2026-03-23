# ws_defs source layout

Commands below assume the current working directory is the skill root.

Edit files in this directory when changing the Figma plugin runtime.
Then run:

```bash
node ./scripts/build_ws_defs_bundle.mjs
```

This rebuilds `ws_defs/code.js` from the ordered source modules below:

1. `00_bootstrap_and_core.js` — 常量、工具函数、颜色/数值序列化
2. `10_variables_and_primitives.js` — 变量收集、paint 诊断、序列化基元
3. `20_routing_and_text.js` — replay 路由分类、paint/effect 序列化、collector、文本序列化
4. `30_scene_snapshot.js` — 场景节点序列化（layout/style/vector/component/tree walk）
5. `35_enrichment_filters.js` — CSS/SVG 过滤判断、节点索引、资源列表构建
6. `40_extraction_transport.js` — 并发控制、enrichment、REST snapshot、transport
7. `50_job_runtime.js` — job 执行、节点定位、主循环
