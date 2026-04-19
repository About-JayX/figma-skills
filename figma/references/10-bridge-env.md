# 10 — Bridge 环境 / 插件 / 命令

Bridge 是 plugin → Node 服务 → pipeline 的三方桥接。本文包含安装 / 环境变量 / 常用命令 / 故障排查。

## 何时读取

- 初次使用本地 bridge
- `NO_PLUGIN_CONNECTION` 错误
- 修改 host / port / timeout
- baseline 导出 / 验收脚本依赖缺失
- 需要找本地产物位置

## 命令约定

所有命令默认从 `skills/figma/` 根目录执行（除非显式指明路径）。

## 系统依赖

```bash
pip3 install numpy Pillow
brew install librsvg             # 可选，plugin A8 已优先导出 PNG，不再强依赖
```

- `fidelity_scorecard.py` / `acceptance_pipeline.py` 依赖 Python + Pillow + numpy
- `rsvg-convert` 仅在 FRAME/SECTION 之外的场景作为 baseline 降级（A8 已覆盖主要类型）
- Node 侧脚本用原生 `fetch`，需 Node ≥ 18

## Bridge 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `FIGMA_BRIDGE_HOST` | `127.0.0.1` | 监听 host |
| `FIGMA_BRIDGE_PORT` | `3333` | 监听 port |
| `FIGMA_BRIDGE_EXTRACT_TIMEOUT_MS` | `180000` | job 超时 |

## ws_defs 插件安装

1. Figma Desktop 打开 `Plugins` → `Development` → `Import plugin from manifest...`
2. 选 `./ws_defs/manifest.json`
3. 目标文件里手动运行 `ws_defs`
4. 插件 UI 显示 "已连接" 后再跑 Node 命令

`manifest.json` 里 `"name": "ws_defs (C5+A8)"` 是当前版本名（含 SVG 并发 4 + FRAME baseline PNG 导出）。更新 plugin 代码后必须 **重新 Import** 让 Figma 拉新 bundle。

`manifest.json` 当前 dev 白名单 `http://localhost:3333`；改 port 需同步改 `manifest.networkAccess.devAllowedDomains`。

## 本地工作流

### 1. 一键抓取 + 交叉校验

```bash
node ./scripts/figma_pipeline.mjs "<figma-url>"
```

自动执行 Step 1.x → 5：
- bridge ensure + extract
- deferred 图片资源拉取
- gradient CSS 富集（A4）
- 变量 token 富集（A3）
- computed CSS 全量富集（新）
- merge cache（可选 MCP）
- cross-validation
- baseline PNG（A8，来自 plugin）
- summary

### 2. 手动调试 bridge

```bash
node ./scripts/bridge_client.mjs health                            # 健康检查
node ./scripts/bridge_client.mjs ensure                            # 启动 server + 等待
node ./scripts/bridge_client.mjs agent "<figma-url>"               # 单次抽取
node ./scripts/bridge_client.mjs asset "<figma-url>" "<hash>"      # 单张延迟图片
```

### 3. merge MCP 缓存（可选）

```bash
node ./scripts/merge_cache.mjs "<figma-url|cache-dir>"
```

MCP 端可用时合并 screenshot / code-connect；无 MCP 时跳过不报错。

### 4. 重建插件 bundle

```bash
node ./scripts/build_ws_defs_bundle.mjs
```

修改 `ws_defs/src/*` 后必须跑。产物 `ws_defs/code.js` 是 gitignored，本地生成。

### 5. 跑多轮 rerender

```bash
python3 ./scripts/acceptance_pipeline.py \
  --manifest acceptance-manifest.json \
  --render-plan render.plan.json \
  --apply-route-escalation \
  --max-iterations 3 \
  --workers 2
```

详见 `09-verification.md`。

## cache 产物位置

目标 cache 目录：`./cache/<fileKey|unknown-file>/<nodeId>/`

常用产物：

| 文件 | 内容 |
|------|------|
| `bridge-response.json` | 原始 bridge 返回（可能几十 MB，默认不加载）|
| `bridge-agent-payload.json` | 精简 agent payload（富集后含 computedCss.*）|
| `cache-manifest.json` | 路径索引 |
| `cross-validation-report.json` | style.* vs node.css 校验结果 |
| `variables-substitution-map.json` | 全局变量名 → CSS 变量映射 |
| `assets/` | 图片资源（`<imageHash>.<format>`）|
| `assets/_baseline_<nodeId>.png` | A8 plugin PNG 原件 |
| `baseline/baseline.png` | 验收用 baseline（pipeline 从 assets 提升）|
| `baseline/baseline.png.lab.npy` | C3 Lab 缓存（scorecard 自动生成）|
| `blobs/svg-*.svg` | 复杂 vector 的完整 SVG |
| `merged-agent-payload.json` | bridge + MCP 合并视图 |
| `merge-summary.md` | 变量 / 资源可用性摘要 |

## 故障排查

### `NO_PLUGIN_CONNECTION`

Bridge 启动了但插件没连上。排查：

1. Figma Desktop 是否运行
2. 插件是否在**当前打开的文件**中执行（切换文件后要重跑）
3. 插件 UI 是否显示 "已连接"（不是 "连接中"）

若以上都正常但还报错：重启 bridge server（`kill` 再 `ensure`），然后重新跑一次插件。

### `/health` 不通

```bash
node ./scripts/bridge_client.mjs ensure
```

会自动启动 server。若启动失败看 stderr 里的端口冲突。

### baseline 导出失败

- FRAME/SECTION/INSTANCE 场景：检查 plugin 版本是否含 A8（manifest name 应为 `ws_defs (C5+A8)`），未更新就重 Import
- VECTOR 场景：检查 `rsvg-convert` 是否安装

### 图片资源缺失

```bash
node ./scripts/bridge_client.mjs asset "<figma-url>" "<image-hash>"
```

按 hash 手动拉取。若持续失败检查插件沙箱内存（大图接近 2GB 限制时 getBytesAsync 会超时）。

### 本地草稿 `fileKey` 缺失

本地 draft 无 `figma.fileKey`。bridge job_store 有 fallback：当只有一个未注册的 plugin client 时允许绑定。正常用不影响。

## 跨平台注意

- macOS：rsvg-convert 来自 `brew install librsvg`；Chrome 在 `/Applications/Google Chrome.app`
- Linux：`apt install librsvg2-bin`；Chrome 通常 `google-chrome` 或 `chromium`
- Windows：WSL 推荐；原生 Windows 下 plugin 正常但脚本的 `spawnSync('which rsvg-convert')` 需改为 `where.exe`

当前 pipeline 的 `generateBaseline()` 自动检测：优先 A8（plugin PNG），其次 rsvg-convert，再其次 headless Chrome。任一可用即可出 baseline。

## 改版 / 迁移约定

- Bridge wire protocol 变动 → 更新 `manifest.name`（比如加版本后缀），强制重新 Import
- ws_defs 脚本更新不改 protocol → 跑 `build_ws_defs_bundle.mjs` 后 Figma 端会在下次运行时自动热加载
- bridge server 改了 route → 必须 `kill` server 后 `ensure` 重启（不自动热加载）
