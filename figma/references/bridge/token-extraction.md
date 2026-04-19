# 变量与 Token 同步

## 目录

- 何时读取
- 命令约定
- 数据源优先级
- 关键产物
- 推荐流程
- 替换原则

## 何时读取

- 任务包含主题变量同步
- 准备把 bridge 的字面色值替换成消费方代码库的 token / CSS 变量
- 需要对账 bridge defs 与 MCP variableDefs 的差异

## 命令约定

本文件中的命令默认从当前 skill 根目录执行。

## 数据源优先级

- `bridge.designSnapshot.resources.variables`：live variable 绑定与 collection / mode 信息
- `bridge.defs.flat` / `bridge.defs.full`：bridge 解析后的扁平 token 结果
- `variable-defs.json`：MCP 提供的变量定义补充
- `merged-agent-payload.json` / `merge-summary.md`：bridge + MCP 的对账视图

如果 bridge 与 MCP 的解析值不一致，不要只按名字相似就替换成 token。优先写死 bridge 的精确值，并在结果里说明偏差。

## 关键产物

目标 cache 目录下重点关注：

- `bridge-agent-payload.json`
- `bridge-response.json`
- `variable-defs.json`
- `merged-agent-payload.json`
- `merge-summary.md`
- `variables-substitution-map.json`：pipeline 生成的 Figma 变量名 → CSS 变量名 + 多 mode 值映射表（`buildSubstitutionMap`，`scripts/lib/variable_substitution.mjs`）

## computedCss.tokens 字段

pipeline Step 1.9 会遍历 `designSnapshot.root`，把 `node.variables.bound` 转为 `node.computedCss.tokens`：

```json
"computedCss": {
  "tokens": {
    "color":       { "cssVar": "--color-neutrals-950", "figmaProp": "fills", "variable": {"name": "Color/neutrals/950", "id": "...", "type": "COLOR"} },
    "font-size":   { "cssVar": "--font-size-text-xs",  "figmaProp": "fontSize", ... },
    "line-height": { "cssVar": "--line-height-text-xs","figmaProp": "lineHeight", ... }
  }
}
```

- **Figma 属性 → CSS 属性** 通过 `FIGMA_PROP_TO_CSS` 映射（fills→color, itemSpacing→gap, topLeftRadius→border-top-left-radius 等）。未知属性保留原名。
- **CSS 变量命名** 保留 CJK 字符：`Color/neutrals/950` → `--color-neutrals-950`，`间距参数/SP0` → `--间距参数-sp0`。
- 节点存在该字段时，**CSS 必须输出 `var(--xxx)` 而非硬编码值**；多 mode 回放时用 `variables-substitution-map.json[figmaName].values[modeName]` 查解析值做 fallback。
- `inferred`（Figma 猜测的变量）不进 tokens，只作信息参考，不能强转。

## 推荐流程

1. 先跑 pipeline：

```bash
node ./scripts/figma_pipeline.mjs "<figma-url>"
```

2. 再跑变量对账：

```bash
node ./scripts/merge_cache.mjs "<figma-url|cache-dir>"
```

3. 检查 `merge-summary.md` 和 `merged-agent-payload.json` 中的 variable diff：

- `shared`：bridge 与 MCP 都存在，可继续比对解析值
- `bridgeOnly`：说明 live binding 已在 bridge 中出现，但 MCP 端未补到
- `mcpOnly`：说明变量命名存在，但当前节点未明确绑定

4. 只有在解析值完全一致时才把 bridge 字面值替换成 token。

## 替换原则

- 颜色 token：比对 RGBA 与 alpha，不能只看变量名
- 数值 token：确认单位与 mode，避免把 spacing / radius / blur 混用
- 文字或字符串 token：确认 collection 与 mode，不要跨语义复用
- bound variables 比“看起来相似的 token 名称”更可信
- 替换不确定时，优先保留 bridge 精确值并记录原因
