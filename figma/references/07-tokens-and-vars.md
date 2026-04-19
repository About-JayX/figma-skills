# 07 — Tokens & Variables

把 Figma 变量绑定转成 CSS 自定义属性（`var(--xxx)`），支持多主题 / 多 mode 回放。

## 何时使用

- 节点属性通过 `node.variables.bound.<prop>` 绑定了变量（**必须**输出 `var(--xxx)` 而非硬编码值）
- 消费方代码库已有 token 层（Design System 的 `--color-brand-500` 等）
- 设计稿有 Light / Dark / 多品牌 mode，需要 CSS 变量切换

## 数据源

三层：

| 源 | 内容 | 用途 |
|----|------|------|
| `node.variables.bound.<prop>` | 单节点的显式绑定（数组 / 单对象）| 这个属性用哪个变量 |
| `node.variables.inferred.<prop>` | Figma 推断的匹配 | **仅参考，不强转**（多候选场景会误匹配）|
| `variables-substitution-map.json`（cache 根目录）| 全局变量名 → CSS 变量名 + 多 mode 解析值 | 生成 `:root` 里的定义 + 多 mode 切换 |
| `node.computedCss.tokens`（pipeline 富集）| `{ [cssProp]: { cssVar, figmaProp, variable } }` | 写节点 CSS 时直接取 `var(cssVar)` |

## 消费流程

### 1. 生成全局 `:root` 变量定义

从 `variables-substitution-map.json` 读全部条目：

```css
:root {
  --color-brand-500: #0066ff;        /* mode: Light */
  --color-neutrals-950: #0a0a0a;     /* mode: Light */
  --font-size-text-xs: 12px;
  --spacing-sp-0: 0px;
  /* ... */
}

[data-theme="dark"] {
  --color-brand-500: #5599ff;        /* mode: Dark */
  --color-neutrals-950: #f5f5f5;
}
```

生成脚本：读 substitution-map 的 `values[modeName]`，按 mode 拆 selector。

### 2. 节点级使用

节点属性若有 `computedCss.tokens[cssProp]`，**CSS 输出 `var(<cssVar>)` 而非硬编码**。

```jsx
/* 原：{ color: '#0a0a0a', fontSize: '12px' } */
/* 正确：{ color: 'var(--color-neutrals-950)', fontSize: 'var(--font-size-text-xs)' } */
```

### 3. Figma 属性 → CSS 属性映射（由 pipeline 自动处理）

| Figma binding prop | CSS prop |
|-------------------|---------|
| `fills` | `color` (for TEXT) / `background-color` (else) |
| `strokes` | `border-color` |
| `fontSize` | `font-size` |
| `fontWeight` | `font-weight` |
| `fontName` | `font-family` |
| `lineHeight` | `line-height` |
| `letterSpacing` | `letter-spacing` |
| `itemSpacing` | `gap` |
| `paddingTop/Right/Bottom/Left` | `padding-*` |
| `topLeftRadius` / `topRightRadius` / `bottomLeftRadius` / `bottomRightRadius` | `border-*-radius` |
| `strokeWeight` / `strokeTopWeight` 等 | `border-width` / `border-*-width` |
| `opacity` | `opacity` |
| `minWidth` / `maxWidth` / `minHeight` / `maxHeight` | 同名 |
| `paragraphSpacing` / `paragraphIndent` | `margin-bottom` / `text-indent` |

## CSS 变量命名

Figma 变量名按如下规则转 CSS：

1. 保留大小写敏感的 ASCII 字母并小写化
2. 保留 Unicode（包括 CJK）
3. 连字符、斜杠、空格、标点合并为单个 `-`
4. 前导 / 尾随 `-` 去除
5. 前缀 `--`

例：
- `Color/neutrals/950` → `--color-neutrals-950`
- `Line Height/text-xs` → `--line-height-text-xs`
- `间距参数/SP0` → `--间距参数-sp0`
- `边框/L2-强调边框,分割色-10%` → `--边框-l2-强调边框-分割色-10`

CSS 规范允许自定义属性用 Unicode 字符，Chrome/Safari/Firefox 都支持。

## 多 mode 切换

### 通过 `data-theme` 属性

```html
<html data-theme="dark">
```

```css
[data-theme="dark"] {
  --color-neutrals-950: #f5f5f5;
  /* ... */
}
```

### 通过 `@media (prefers-color-scheme: dark)`

```css
@media (prefers-color-scheme: dark) {
  :root {
    --color-neutrals-950: #f5f5f5;
  }
}
```

两种方式可以叠加——先看用户偏好，用户可手动覆盖。

## 未解析 / 冲突场景

| 场景 | 处理 |
|------|------|
| 变量 `values` 某 mode 缺失 | 用 `defaultModeId` 的值，或报告警告 |
| `computedCss.tokens[prop]` 存在但 CSS 变量名冲突（命名 collision） | pipeline 应报警；手动重命名变量或加 scope 前缀 |
| `inferred` 有多个候选 | **不自动选择**，agent 输出 `/* inferred: <list> — confirm before substituting */` 并保留硬编码 |
| 消费方代码库 token 名与 Figma 不一致 | pipeline 支持 `token-alias.json`（未来）；当前手动 map |

## 自检

- [ ] 凡是 `computedCss.tokens[prop]` 存在的节点属性，CSS 都输出了 `var(<cssVar>)`
- [ ] `:root` 里有所有用到的变量定义
- [ ] 多 mode 场景每个 mode 都有对应 selector 覆盖
- [ ] `inferred` 绑定没强转为 `var()`
- [ ] CSS 变量名在浏览器 DevTools 能查到且值正确
