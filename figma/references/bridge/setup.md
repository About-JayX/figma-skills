# 环境与 Bridge 配置

## 目录

- 何时读取
- 命令约定
- 系统依赖
- Bridge 环境变量
- ws_defs 插件安装
- 常见问题

## 何时读取

- 初次使用本地 bridge
- 遇到 `NO_PLUGIN_CONNECTION`
- 需要修改 host / port / timeout
- baseline 导出或验收脚本依赖缺失

## 命令约定

本文件中的命令默认从当前 skill 根目录执行。

## 系统依赖

```bash
pip3 install numpy Pillow
brew install librsvg
```

说明：

- `fidelity_scorecard.py` / `acceptance_pipeline.py` 依赖 Python 与 Pillow / numpy
- baseline SVG 转 PNG 依赖 `rsvg-convert`
- Node 侧脚本使用 `fetch`，建议使用支持原生 `fetch` 的较新 Node 版本

## Bridge 环境变量

- `FIGMA_BRIDGE_HOST`：默认 `127.0.0.1`
- `FIGMA_BRIDGE_PORT`：默认 `3333`
- `FIGMA_BRIDGE_EXTRACT_TIMEOUT_MS`：默认 `180000`

`bridge_client.mjs ensure` 会在本地启动 `./scripts/bridge_server.mjs`，然后轮询 `/health`。

## ws_defs 插件安装

1. 在 Figma Desktop 打开 `Plugins -> Development -> Import plugin from manifest...`
2. 选择 `./ws_defs/manifest.json`
3. 打开目标设计文件后手动运行 `ws_defs`
4. 确认插件 UI 显示 bridge SSE 已连接，再重新运行本地命令

`./ws_defs/manifest.json` 当前允许的开发域名是 `http://localhost:3333`。

## 常见问题

- `NO_PLUGIN_CONNECTION`：bridge server 已启动，但插件没有连接；优先检查 Figma Desktop 是否正在运行、插件是否在当前文件中执行
- `/health` 不通：先运行 `node ./scripts/bridge_client.mjs ensure`
- baseline 导出失败：确认 `rsvg-convert` 已安装
- 图片资源缺失：先重新跑 pipeline，再按 image hash 执行 `bridge_client.mjs asset`
