# Codex Desktop for Linux

非官方 Linux 构建包装器，将 [OpenAI Codex Desktop](https://openai.com/codex/) 转换为可在 Linux 上运行的 Electron 应用。

官方 Codex 桌面版仅提供 macOS 和 Windows 版本；本仓库通过转换上游 macOS `Codex.dmg` 来生成可运行的 Linux Electron 应用。

项目可构建原生 `.deb`、`.rpm` 和 `.pkg.tar.zst` 包，支持本地 AppImage 自构建和 Nix，并可安装本地自动更新管理器，在有新版上游 DMG 时自动重建。

在提交 Pull Request 前，请阅读 [CONTRIBUTING.md](../CONTRIBUTING.md)。实现细节参见 [AGENTS.md](../AGENTS.md)。

---

## 按平台安装

| 平台 | 推荐方式 | 说明 |
|------|---------|------|
| Debian, Ubuntu, Pop!_OS, Mint, Elementary | `make bootstrap-native` | 构建并安装 `.deb` |
| Fedora | `make bootstrap-native` | 构建并安装 `.rpm` |
| openSUSE | `make bootstrap-native` | 构建并安装 `.rpm` |
| Arch, Manjaro, EndeavourOS | `make bootstrap-native` | 构建并安装 pacman 包 |
| NixOS / Nix | `nix run github:ilysenko/codex-desktop-linux` | 参见 [Nix 文档](nix.md) |
| 原子桌面/其他发行版 | `make build-app && make appimage` | 本地自构建，无自动更新 |

原生安装：

```bash
git clone https://github.com/ilysenko/codex-desktop-linux.git
cd codex-desktop-linux
make bootstrap-native
```

如果依赖已安装：

```bash
make install-native
```

`make bootstrap-native` 会安装构建依赖、下载最新上游 `Codex.dmg`、构建 `codex-app/`、为当前发行版打包并安装最新产物到 `dist/`。

如果需要在 Fedora 上手动安装依赖：

```bash
# Fedora 41+
sudo dnf install python3 7zip curl unzip rpm-build @development-tools

# Fedora < 41
sudo dnf install python3 p7zip p7zip-plugins curl unzip rpm-build
sudo dnf groupinstall 'Development Tools'
```

首次运行向导和可选功能选择器：

```bash
make setup-native
```

详情参见 [Native setup](native-setup.md)，包含向导、非交互式功能选择、清理流程和 `PACKAGE_WITH_UPDATER=0`。

---

## 安装前须知

生成的应用和原生包会捆绑托管的 Linux Node.js 运行时。正常安装、Browser Use、Codex CLI 安装/更新或本地自动更新重建**不需要**发行版的 `nodejs` / `npm` 包。

运行时仍需 Codex CLI。首次启动可通过内置 `npm` 安装或更新 `@openai/codex`，也可自行管理 CLI。

支持 X11 和 Wayland 会话。启动器在 Wayland 下优先使用 XWayland（以获得更好的 Electron 弹窗定位），然后回退到 Electron 的自动 Wayland 处理。GPU、Vulkan 和 `/tmp noexec` 问题的解决方法参见 [Troubleshooting](troubleshooting.md)。

---

## 功能矩阵

| 功能 | 默认 | 启用方式 | 文档 |
|------|------|---------|------|
| 标准 Codex Desktop UI | 始终启用 | 安装或运行生成的应用 | 本文档 |
| 托管的 Linux Node.js 运行时 | 始终启用 | 构建/安装时自动捆绑 | [构建与打包](build-and-packaging.md) |
| 原生包 | 始终启用 | `make package && make install` | [构建与打包](build-and-packaging.md) |
| 自动更新管理器 | 原生包 | 默认包含，`PACKAGE_WITH_UPDATER=0` 除外 | [更新器](updater.md) |
| AppImage 自构建 | 手动 | `make build-app && make appimage` | [构建与打包](build-and-packaging.md#appimage-local-self-build) |
| Nix flake | 手动 | `nix run github:ilysenko/codex-desktop-linux` | [Nix](nix.md) |
| GUI 安装提示 | 如已安装 | 使用 `kdialog` / `zenity`，回退到终端 | [原生安装](native-setup.md) |
| Linux 文件管理器集成 | 始终启用 | 内置于核心 Linux 补丁 | [架构](architecture.md) |
| Chrome 插件原生主机 | 始终启用 | 与捆绑插件一同安装 | [架构](architecture.md) |
| 浏览器标注 | 始终启用 | 内置于修补后的 webview | [架构](architecture.md) |
| 托盘和热启动切换 | 始终启用 | 正常启动应用即可 | [架构](architecture.md) |
| 多实例 | 可选 | `./codex-app/start.sh --new-instance` | [构建与打包](build-and-packaging.md#running-the-generated-app) |
| Linux Computer Use 后端 | 捆绑 | MCP 后端默认注册 | [Linux Computer Use](linux-computer-use.md) |
| Linux Computer Use UI | 可选 | `CODEX_LINUX_ENABLE_COMPUTER_USE_UI=1` 或设置标志 | [Linux Computer Use](linux-computer-use.md#enable-the-in-app-ui) |
| Linux Features 框架 | 可选 | 编辑 `linux-features/features.json` | [Linux Features](linux-features/README.md) |
| Agent Workspaces | 可选 | `agent-workspace` | [文档](linux-features/agent-workspace/README.md) |
| Linux AppShots | 可选 | `appshots` | [文档](linux-features/appshots/README.md) |
| Wrapper 更新按钮 | 可选 | `codex-wrapper-updater` | [文档](linux-features/codex-wrapper-updater/README.md) |
| 对话模式 | 可选 | `conversation-mode` | [文档](linux-features/conversation-mode/README.md) |
| Copilot 推理努力值默认值 | 可选 | `copilot-reasoning-effort` | [文档](linux-features/copilot-reasoning-effort/README.md) |
| Linux Feature 示例 | 开发示例 | `example-feature` | [文档](linux-features/example-feature/README.md) |
| Open Target Discovery | 可选 | `open-target-discovery` | [文档](linux-features/open-target-discovery/README.md) |
| 朗读按钮 | 可选 | `read-aloud` | [文档](linux-features/read-aloud/README.md) |
| 朗读 MCP | 可选 | `read-aloud-mcp` | [文档](linux-features/read-aloud-mcp/README.md) |
| 远程控制 UI 门控 | 可选 | `remote-control-ui` | [文档](linux-features/remote-control-ui/README.md) |
| 实验性远程移动控制 | 可选 | `remote-mobile-control` | [文档](linux-features/remote-mobile-control/README.md) |
| Thorium Chrome 插件支持 | 可选 | `thorium-chrome-plugin` | [文档](linux-features/thorium-chrome-plugin/README.md) |
| Zed 打开器 | 可选 | `zed-opener` | [文档](linux-features/zed-opener/README.md) |

由服务端控制的上游功能（如模型发布）由 OpenAI 按账户管理。重建此包装器不会解锁它们。

---

## 可选的 Linux Feature

仅限 Linux 的可选集成位于 `linux-features/` 目录下，默认禁用。它们可以在不改变核心构建流程的情况下添加 ASAR 补丁、暂存资源、运行时钩子、包钩子或旧的构建/安装钩子。

在构建前启用手动跟踪或本地功能：

```bash
cp linux-features/features.example.json linux-features/features.json
```

```json
{
  "enabled": [
    "read-aloud",
    "zed-opener"
  ]
}
```

私有用户本地功能可存放在 git 忽略的 `linux-features/local/<feature-id>/` 目录下，使用相同的 `feature.json` 约定。更改功能选择后需重新构建：

```bash
make install-native
```

完整约定：`linux-features/README.md` 和 [`docs/linux-features-architecture.md`](linux-features-architecture.md)。

---

## 更新

默认原生包会安装 `codex-update-manager`，这是一个 `systemd --user` 服务，它会检查更新的上游 DMG、重建本地原生包并在 Codex Desktop 退出后安装。最终安装使用 `pkexec`。最小化窗口管理器会话需要图形化的 polkit 认证代理来使用应用内安装按钮；否则更新器会准备好包并通过终端报告 `sudo /usr/bin/codex-update-manager ... --path ...` 命令。

手动更新包：

```bash
PACKAGE_WITH_UPDATER=0 make package
make install
```

从可信签出手动重建：

```bash
PACKAGE_WITH_UPDATER=0 make update-native
```

AppImage 构建和仅仓库生成的应用不包含原生包更新器。参见 [Updater](updater.md)。

---

## 构建、打包和运行

生成本地 Electron 应用：

```bash
make build-app-fresh
make run-app
```

使用本地 DMG：

```bash
make build-app DMG=/path/to/Codex.dmg
```

构建并安装包：

```bash
make package
make install
```

构建特定产物：

```bash
make deb
make rpm
make pacman
make appimage
```

包脚本仅重新打包已生成的 `codex-app/`。它们不会自行下载或提取 DMG。参见 [构建与打包](build-and-packaging.md)。

---

## 故障排查

| 问题 | 首选措施 |
|------|---------|
| `/tmp` 挂载为 `noexec` | 将 `TMPDIR` 和 `XDG_CACHE_HOME` 设为 `$HOME` 下可执行目录 |
| 空白窗口或启动画面卡住 | 检查 `~/.cache/codex-desktop/launcher.log` 以及端口 `5175` 是否已被占用 |
| `CODEX_CLI_PATH` 或 CLI 安装错误 | 重新打开应用或手动安装 `@openai/codex` |
| Wayland / GPU / Vulkan 挂起 | 尝试 `CODEX_LINUX_RENDERING_MODE=wayland-gpu ./codex-app/start.sh` 或持久启动标志 |
| 调整大小时出现残影或帧残留 | 尝试 `CODEX_ELECTRON_DISABLE_GPU_COMPOSITING=1 ./codex-app/start.sh` 或 `--disable-gpu-compositing` |
| Computer Use UI 隐藏 | 启用 UI 可选功能；账户/服务器发布可能仍会隐藏服务端控制的部件 |
| Computer Use 无输入后端 | 检查 `/dev/uinput`、portal 支持或 `ydotoold` / `ydotool.service` |
| 更新器似乎卡住 | 检查 `codex-update-manager status --json` 和服务日志 |

完整列表：[Troubleshooting](troubleshooting.md)。

---

## 项目文档

- [Native setup](native-setup.md) — 原生安装向导
- [Nix](nix.md) — Nix flake 使用说明
- [Linux Computer Use](linux-computer-use.md) — Linux Computer Use 后端
- [Updater](updater.md) — 更新管理器设计
- [Build and packaging](build-and-packaging.md) — 构建流水线和打包参考
- [Troubleshooting](troubleshooting.md) — 常见问题排查
- [Architecture](architecture.md) — 整体架构
- [GitHub CLI auth](github-cli-auth.md) — GitHub CLI 认证
- [Linux Features architecture](linux-features-architecture.md) — Linux 功能框架
- [Webview server evaluation](webview-server-evaluation.md) — Webview 服务评估

---

## 本地构建指南

如果你在国内网络环境或需要更详细的构建步骤，请参阅 [本地构建指南](LOCAL-BUILD.zh.md)，其中包含：

- 国内镜像加速配置（npm、cargo、Electron）
- motrix-next/aria2 多线程下载大文件
- 常见构建问题排查
- `CODEX_DMG_FORCE_CACHE` 等环境变量说明

---

## 免责声明

这是一个非官方社区项目。Codex Desktop 是 OpenAI 的产品。此工具不重新分发任何 OpenAI 软件；它自动化了用户在其自有副本上执行的转换过程。

## 许可

MIT
