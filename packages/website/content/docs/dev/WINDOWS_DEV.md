# Windows 环境前置要求

本文件在以下环境实测通过：Windows 11（10.0.26300）、Node v24.14.0、pnpm 10.33.4、Python 3.14.6、Visual Studio 2022 生成工具。

## 系统要求

- 磁盘：Visual Studio 2022 生成工具约 3.4 GB（另有约 3.4 GB 落在系统盘），依赖与 Electron 缓存约 5 GB，建议预留 20 GB 以上。
- 内存：Electron 构建建议 8 GB 以上。

## 前置条件

- Node.js `>= 20.19.0`（release CI 用 24.14.1）
- pnpm `10.33.4`（由根 `package.json` 的 `packageManager` 字段锁定）
- Python `>= 3.12`（node-gyp 使用；其 Python 范围是 `>=3.6.0`，没有上限）
- **Visual Studio 2022 生成工具**——见第 2 步

### 1. Node 与 pnpm

Node 安装在 `Program Files` 下，`corepack enable` 需要管理员权限的 PowerShell：

```powershell
corepack enable pnpm
cd <仓库目录>
pnpm -v        # 10.33.4
```

Corepack 依据"当前目录向上最近的一个 `package.json` 的 `packageManager` 字段"选择版本；在仓库外执行会回落到最新大版本（如 12.x）。需要统一时：

```powershell
corepack prepare pnpm@10.33.4 --activate
```

> 不要用 `npm i -g pnpm`（与 Corepack 的 shim 冲突），也不要在仓库内执行 `corepack use pnpm@...`（会改写 `packageManager` 字段）。

### 2. Visual Studio 2022 生成工具

| 组件                                                       | 是否必需                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------- |
| 工作负载：使用 C++ 的桌面开发                              | 必需                                                     |
| MSVC v143 - VS 2022 C++ x64/x86 生成工具                   | 必需                                                     |
| Windows 11 SDK（10.0.26100.x）                             | 必需                                                     |
| MSVC v143 - VS 2022 C++ x64/x86 Spectre 缓解库（单个组件） | 建议                                                     |
| 适用于 Windows 的 C++ Clang 工具                           | **不勾选**——`.npmrc` 里的 `clang=0` 就是为了避开 ClangCL |

为什么必须是 2022 而不是更高的版本：根 `.npmrc` 写死了 `msvs_version=2022`；且 `pnpm install` 阶段真正编译原生模块的，是 **pnpm 自带的 node-gyp 11.5.0**，它认的 VS 年份只有 `[2019, 2022]`。Visual Studio 18（VS 2026）会被判成 `unknown version "undefined"`，编译直接失败。锁文件里的 `node-gyp@12.x` 虽然支持 2026，但它只属于 `@electron/rebuild`，仅在 electron-rebuild 阶段使用，救不了 install 阶段。

安装结果验证：

```powershell
& "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -products * -property installationPath
```

输出中必须包含 `...\2022\BuildTools`。

### 3. 网络（可选）

连接 `registry.npmjs.org` 缓慢或超时时：

```powershell
pnpm config set registry https://registry.npmmirror.com --location=user
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
```

- `@jsr` 前缀的包没有镜像，仍走仓库 `.npmrc` 里的 `npm.jsr.io`（scoped registry 优先级高于用户级 registry）。
- `scripts/postinstall.ts` 在直连失败时会自动回退到 npmmirror，提前设置只是省掉等待直连超时的那段时间。

## 安装

```powershell
cd <仓库目录>
pnpm install
pnpm run dev
```

`pnpm install` 会执行 `scripts/postinstall.ts`，依次是：

1. 恢复 `native-keymap` 源码
2. 下载 Electron 二进制（约 100 MB，最耗时）
3. 用 `patch-package` 打 C++20 补丁
4. 用 `electron-rebuild` 按 Electron ABI 重编译原生模块（keytar、ced、native-keymap）
5. 压缩 locales
6. 生成 `@muyajs/core` 类型

## 常见问题与处理

### 问题：`gyp ERR! find VS ... Could not find any Visual Studio installation to use`

```text
gyp ERR! find VS - looking for Visual Studio version 2026
gyp ERR! find VS unknown version "undefined" found at "D:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools"
```

**处理**：安装 Visual Studio **2022** 生成工具。不要设置 `$env:npm_config_msvs_version = "2026"`——仓库 `.npmrc` 里的 `2022` 才是正确值。

### 问题：`ced@2.0.0 ... Running install script, failed`

**处理**：同上。`keytar` 装的是预编译产物，不受影响；`ced` 必须源码编译。`native-keymap` 失败不致命——它是可选依赖，postinstall 会重建它。

### 问题：`'electron-vite' 不是内部或外部命令`

**处理**：这只是表象。`pnpm install` 没有走完，`packages/desktop/node_modules/.bin` 没建立。去看第 4 步原生模块的编译输出，而不是去查 electron-vite。

### 问题：`ERR_SOCKET_TIMEOUT` / `Tarball download average speed ... is below 50 KiB/s`

**处理**：改用 npmmirror 源，见第 3 步。

### 问题：`pnpm -v` 输出 12.x

**处理**：在仓库外执行导致的。进仓库目录再执行，或运行 `corepack prepare pnpm@10.33.4 --activate`。

## 本地打包

- 先改 `packages/desktop/package.json` 的 `version`——默认的 `0.22.0-dev` 会进入产物文件名。
- `pnpm run build:win:x64` 或 `pnpm run build:win:arm64`；简写的 `build:win` 脚本写死了 `--x64`。
- 产物落在**仓库根 `dist/`**（`output: ../../dist`）：NSIS `setup.exe` + `zip`。
- `electron-builder.yml` 是 `npmRebuild: false`，原生模块必须在 electron-rebuild 阶段就编好，打包阶段不再重建。
- 没有签名配置，用户安装时会被 SmartScreen 拦截；要消除需 OV/EV 代码签名证书。
- 没有 `publish` 配置，产物不含自动更新元数据。

标签驱动的发布流程见 `RELEASE.md`。
