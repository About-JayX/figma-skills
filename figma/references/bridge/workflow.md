# Bridge 工作流

## 目录

- 何时读取
- 命令约定
- 本地工作流
- cache 与输出物

## 何时读取

- 需要手动运行 bridge / merge / build 脚本
- 需要定位 cache 产物、baseline、merge 输出物
- 需要确认当前节点的本地产物结构

## 命令约定

本文件中的命令默认从当前 skill 根目录执行。

## 本地工作流

1. 一键抓取并交叉校验：

```bash
node ./scripts/figma_pipeline.mjs "<figma-url>"
```

2. 手动调试 bridge：

```bash
node ./scripts/bridge_client.mjs health
node ./scripts/bridge_client.mjs ensure
node ./scripts/bridge_client.mjs agent "<figma-url>"
node ./scripts/bridge_client.mjs asset "<figma-url>" "<image-hash>"
```

3. 合并 bridge 与 MCP 缓存：

```bash
node ./scripts/merge_cache.mjs "<figma-url|cache-dir>"
```

4. 修改 `ws_defs/src/*` 后重建插件 bundle：

```bash
node ./scripts/build_ws_defs_bundle.mjs
```

5. 生成详细验收计划并跑多轮 rerender：

```bash
python3 ./scripts/acceptance_pipeline.py \
  --manifest acceptance-manifest.json \
  --render-plan render.plan.json \
  --apply-route-escalation \
  --max-iterations 3
```

## cache 与输出物

目标 cache 目录位于 `./cache/<fileKey>/<nodeId>/`。常用产物：

- `bridge-response.json`：原始 bridge 返回值
- `bridge-agent-payload.json`：面向 agent 的精简 payload
- `cache-manifest.json`：cache 路径、bridge / mcp 文件索引和 merge 优先级
- `cross-validation-report.json`：style.* vs node.css 校验结果
- `assets/`：bridge 下载的图片资源
- `baseline-source.svg` / `baseline/`：baseline 导出件
- `merged-agent-payload.json`：bridge + MCP 的合并视图
- `merge-summary.md`：变量与资源可用性摘要
