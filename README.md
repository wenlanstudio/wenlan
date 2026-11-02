<p align="center"><img src="packages/desktop/static/logo-small.png" alt="文览 Wenlan Studio" width="100" height="100"></p>

<h1 align="center">文览 · Wenlan Studio</h1>

<div align="center">
  <strong>一份 Markdown，多种看法。</strong><br>
  A Markdown editor with document, column, slide, present and A4 paper views.<br>
  <sub>Available for Windows, macOS and Linux.</sub>
</div>

<br>

<div align="center">
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/quqingyuan/wenlan-studio.svg" alt="LICENSE">
  </a>
  <a href="https://github.com/quqingyuan/wenlan-studio/releases">
    <img src="https://img.shields.io/github/downloads/quqingyuan/wenlan-studio/total.svg" alt="total download">
  </a>
  <a href="https://github.com/quqingyuan/wenlan-studio/releases/latest">
    <img src="https://img.shields.io/github/downloads/quqingyuan/wenlan-studio/latest/total.svg" alt="latest download">
  </a>
</div>

<div align="center">
  <h3>
    <a href="#features">Features</a>
    <span> | </span>
    <a href="#download">Download</a>
    <span> | </span>
    <a href="#development">Development</a>
    <span> | </span>
    <a href="#license">License</a>
  </h3>
</div>

## Features

- **文（Flow）**：专注写作的实时预览编辑器。
- **栏（Column）**：长文分栏阅读。
- **览（Slide）**：把同一份 Markdown 逐页浏览。
- **示（Present）**：全屏放映，Esc 退出。
- **纸（Paper）**：A4 纸面投影，所见即所印。
- 同一份源文档在几种形态间切换，不导出、不复制。
- 支持 CommonMark、GFM、KaTeX 数学公式、front matter、代码高亮与图表。
- 输出 HTML 和 PDF。

## Download

<https://github.com/quqingyuan/wenlan-studio/releases/latest>

- Windows：`wenlan-win-x64-<version>-setup.exe`（NSIS，可选安装目录）
- macOS：`wenlan-mac-<arch>-<version>.dmg`（未签名，首次打开需清理 quarantine）
- Linux：AppImage / deb / rpm / tar.gz

## Development

```bash
pnpm install
pnpm run dev
pnpm run build:win:x64   # Windows installer + zip -> dist/
```

More detail lives in [AGENTS.md](AGENTS.md).

## Attribution

Wenlan Studio is a fork of [MarkText](https://github.com/marktext/marktext), which is
MIT-licensed. The original copyright notice is retained in [LICENSE](LICENSE).
The slide/present rendering engine is built on
[md2slides](https://github.com/quqingyuan/md2slides).

## License

[**MIT**](LICENSE).
