# 02 — CSS Reset（强制）

写代码的第一步复制这一块到样式表顶部。不复制 = 文本位置、按钮、链接会被浏览器默认样式挤偏，scorecard 的 SSIM 直接从 0.98 掉到 0.87 量级（实测）。

## 模板

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
h1, h2, h3, h4, h5, h6,
p, button, a,
ul, ol, li, dl, dt, dd,
figure, blockquote, form, fieldset {
  margin: 0;
  padding: 0;
  font: inherit;
  color: inherit;
  background: transparent;
  border: 0;
}
a { text-decoration: none; }
button { cursor: pointer; }
img, svg, video { display: block; max-width: 100%; }
input, textarea, select { font: inherit; color: inherit; background: transparent; border: 0; outline: 0; }
table { border-collapse: collapse; }
```

## 为什么每条都不能省

| 规则 | 不写的后果 |
|------|-----------|
| `* margin: 0; padding: 0` | h1 默认 `0.67em` margin，116px 字号时挤下 ~78px |
| `font: inherit; color: inherit` 于 button/a/input | 表单控件系统字体（SF Pro / Segoe UI）替换掉设计稿指定字体 |
| `background: transparent` 于 button | Chrome 默认 `buttongray` 灰底 |
| `border: 0` 于 button/fieldset | 按钮 2px 3D 边框，fieldset 组框边框 |
| `a text-decoration: none` | 链接强制下划线 |
| `img display: block` | 图片按 baseline 对齐，父 flex 时多出 ~3px 底部 gap |
| `* box-sizing: border-box` | padding + border 撑破 width |
| `input border: 0; outline: 0` | 输入框获焦时浏览器默认 focus ring |

## 放在框架里

- React / Next.js：`app/globals.css` 或 `src/index.css` 最顶部
- Vue：`App.vue` 的 `<style>` 或独立 `reset.css`
- 单文件 HTML：`<style>` 块最顶部
- 不使用 Tailwind preflight 时必须手动放这一块；使用 preflight 时大部分已覆盖，但 `h1-h6` 仍需检查
