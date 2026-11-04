<p align="center"><img src="packages/desktop/static/logo-small.png" alt="文览 Wenlan" width="100" height="100"></p>

<h1 align="center">文览 Wenlan</h1>

<div align="center">
  <strong>文览 · 一文多览</strong><br>
  A Markdown editor with document, column, slide, present and A4 paper views.<br>
  <sub>Available for Windows, macOS and Linux.</sub>
</div>

<br>

<div align="center">
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/wenlanstudio/wenlan.svg" alt="LICENSE">
  </a>
  <a href="https://github.com/wenlanstudio/wenlan/releases">
    <img src="https://img.shields.io/github/downloads/wenlanstudio/wenlan/total.svg" alt="total download">
  </a>
  <a href="https://github.com/wenlanstudio/wenlan/releases/latest">
    <img src="https://img.shields.io/github/downloads/wenlanstudio/wenlan/latest/total.svg" alt="latest download">
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
- **示（Present）**：全屏放映，Esc 退出；放映中可点 ▶ 运行代码块。
- **纸（Paper）**：A4 纸面投影，所见即所印。
- 同一份源文档在几种形态间切换，不导出、不复制。
- 支持 CommonMark、GFM、KaTeX 数学公式、front matter、代码高亮与图表。
- 输出 HTML 和 PDF。

## Download

<https://github.com/wenlanstudio/wenlan/releases/latest>

- Windows：`wenlan-win-x64-<version>-setup.exe`（NSIS，可选安装目录）
- macOS：`wenlan-mac-<arch>-<version>.dmg`（未签名，首次打开需清理 quarantine）
- Linux：AppImage / deb / rpm / tar.gz

## Development

```bash
pnpm install
pnpm run dev
pnpm run build:win:x64   # Windows installer + zip -> dist/
```

### 代码块运行配置

引擎层参数（解释器路径、数据库连接、SSH 目标等机器相关配置）读
`~/.wenlan/mdcode2run.json`，可用环境变量 `MD2R_CONFIG_FILE` 改路径。格式与
mdcode2run CLI 的 `--config` 一致：

```json
{
  "hive": {
    "SSH_HOST": "node0",
    "SSH_USER": "zhangsan",
    "SSH_BIN": "C:/Windows/System32/OpenSSH/ssh.exe",
    "CLIENT": "/opt/bigdata/hive/default/bin/beeline",
    "HOST": "localhost",
    "DATABASE": "zjsm",
    "USER": "zhangsan",
    "TIMEOUT": 60000
  }
}
```

HiveServer2 只在集群节点本机监听、本机又没有 beeline 时，`hive.SSH_HOST` 会把查询经
SSH 送到远端 beeline（SQL 走 stdin，不经 cmd / ssh / 远端 shell 的引号解析）。改配置后
需重启应用或关闭文档重开——引擎按文档路径单例，运行中不会重读。秘密与机器参数只放
这里，讲义 front-matter 无权指定。

More detail lives in [AGENTS.md](AGENTS.md).

## Attribution

Wenlan is a fork of [MarkText](https://github.com/marktext/marktext), which is
MIT-licensed. The original copyright notice is retained in [LICENSE](LICENSE).
The slide/present rendering engine is built on
[md2slides](https://github.com/wenlanstudio/md2slides).

## License

[**MIT**](LICENSE).
