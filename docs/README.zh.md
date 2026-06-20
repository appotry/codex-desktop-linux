# Codex Desktop for Linux

> **非官方** Linux 构建包装器，将 macOS 版 [OpenAI Codex Desktop](https://openai.com/codex/) 转换为 Linux Electron 应用。
>
> 官方 Codex 桌面版仅提供 macOS 和 Windows 版本。本项目通过下载官方 macOS 的 `Codex.dmg`，解包并打上 Linux 补丁，生成可在 Linux 上运行的应用。

[![CI](https://img.shields.io/github/actions/workflow/status/ilysenko/codex-desktop-linux/ci.yml?label=CI)](https://github.com/ilysenko/codex-desktop-linux/actions)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

## 功能特性

- 构建 `.deb`、`.rpm`、`.pkg.tar.zst` 原生包
- 支持本地 AppImage 自构建
- 支持 Nix flake
- 内置自动更新管理器（systemd 用户服务）
- 原生 Linux 体验：托盘图标、文件管理器集成、Chrome 插件、Wayland 支持

## 快速开始

### 前置依赖

```bash
sudo apt install p7zip-full curl unzip make g++ python3
```

### 构建与安装

```bash
git clone https://github.com/ilysenko/codex-desktop-linux.git
cd codex-desktop-linux
make bootstrap-native
```

或分步执行：

```bash
make build-app           # 解包 DMG + 编译
make package             # 打包为 .deb
sudo dpkg -i dist/*.deb  # 安装
```

### 直接运行（不安装）

```bash
./codex-app/start.sh
```

## 文档

| 文档 | 说明 |
|------|------|
| [English README](../README.md) | 项目主文档（英文） |
| [本地构建指南](LOCAL-BUILD.zh.md) | 中文构建指南（含国内镜像加速） |
| [Native setup](docs/native-setup.md) | 首次运行向导 |
| [Troubleshooting](docs/troubleshooting.md) | 故障排查 |
| [Build and packaging](docs/build-and-packaging.md) | 构建与打包详解 |

## 许可

MIT
