# Codex Desktop Linux 构建指南

> 将 macOS Codex 桌面版转为 Linux Electron 应用的非官方构建方案
> 项目地址：https://github.com/ilysenko/codex-desktop-linux

---

## 1. 背景

OpenAI Codex Desktop 官方只提供 macOS 和 Windows 版。[ilysenko/codex-desktop-linux](https://github.com/ilysenko/codex-desktop-linux) 是一个非官方社区项目，通过下载官方 macOS 的 `Codex.dmg`，解包后打上 Linux 补丁，最终生成可在 Linux 上运行的 Electron 应用。

构建流程：
1. 下载 macOS 版 Codex.dmg（497MB）
2. 用 7z 解包提取 Electron 应用
3. 安装 npm 依赖 + 编译原生模块
4. 打 Linux 补丁（窗口、Shell、Chrome 插件等）
5. 打包为 .deb / .rpm / AppImage

---

## 2. 直接下载安装（无需构建）

如果不想从源码构建，可以直接从 GitHub Releases 下载预构建的安装包。

### 2.1 从 Releases 下载

访问 [GitHub Releases 页面](https://github.com/appotry/codex-desktop-linux/releases)，根据你的发行版选择对应包：

| 发行版 | 下载文件 | 说明 |
|--------|---------|------|
| Debian / Ubuntu / Pop!_OS / Mint | `codex-desktop_*.deb` | 通用 deb 包 |
| Fedora / RHEL / openSUSE | `codex-desktop-*.rpm` | 通用 rpm 包 |
| Arch / Manjaro / EndeavourOS | `codex-desktop-*.pkg.tar.zst` | Pacman 包 |
| 任何发行版 | `codex-desktop-*.AppImage` | 无需安装，直接运行 |

### 2.2 安装方法

```bash
# Debian/Ubuntu（替换 * 为实际版本号）
sudo dpkg -i codex-desktop_*.deb
sudo apt install -f   # 如有依赖问题

# Fedora/RHEL
sudo rpm -ivh codex-desktop-*.rpm

# Arch Linux
sudo pacman -U codex-desktop-*.pkg.tar.zst

# AppImage（无需安装）
chmod +x codex-desktop-*.AppImage
./codex-desktop-*.AppImage
```

安装后启动：
```bash
codex-desktop
```

首次启动会提示安装 Codex CLI，按引导操作即可。

> **注意**：预构建包可能与你的系统不完全兼容。如有问题，请从源码构建（见 §4 源码构建）。

---

## 3. 前置条件

### 7.1 系统依赖

```bash
# Ubuntu/Debian
sudo apt install p7zip-full curl unzip

# Rust 工具链（编译原生模块需要）
rustup default stable
```

### 2.2 构建环境变量

这些变量可以跳过大文件的重复下载：

```bash
# Node 24（复用 mise 已安装的版本，跳过下载 Node 22）
export CODEX_MANAGED_NODE_SOURCE="$HOME/.local/share/mise/installs/node/24.17.0"

# Electron v42.1.0（跳过 Electron 下载，需提前缓存）
export CODEX_ELECTRON_ZIP_SOURCE="$HOME/.cache/codex-desktop/electron/electron-v42.1.0-linux-x64.zip"

# Electron 镜像（备用下载源，用于首次构建）
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
```

---

## 4. 网络加速（国内用户必读）

海外用户可跳过此节。国内访问 GitHub / crates.io / OpenAI CDN 极慢，必须配置。

### 7.1 cargo 镜像

国内访问 crates.io 极慢，必须配置镜像：

```bash
# ~/.cargo/config.toml
[source.crates-io]
replace-with = "sjtug-sparse"

# 上海交大镜像（支持 sparse 协议，HTTP 直连，比 git 协议快数十倍）
[source.sjtug-sparse]
registry = "sparse+https://mirrors.sjtug.sjtu.edu.cn/crates.io-index/"
```

验证：
```bash
# 确认能正常拉取 crate 元数据
curl -sI --max-time 10 "https://mirrors.sjtug.sjtu.edu.cn/crates.io-index/config.json"
# 应返回 HTTP/2 200
```

### 7.2 预下载大文件

用 motrix-next（aria2 前端）多线程下载，避免 curl 单线程超时：

```bash
# Codex.dmg（497MB）
motrix-next download-add url="https://persistent.oaistatic.com/codex-app-prod/Codex.dmg" dir="$HOME/Work/codex-desktop-linux"

# Electron v42.1.0（114MB）
motrix-next download-add url="https://npmmirror.com/mirrors/electron/v42.1.0/electron-v42.1.0-linux-x64.zip" dir="$HOME/.cache/codex-desktop/electron"
```

或者通过 aria2 RPC 直接调用：
```bash
# aria2 RPC 默认在 localhost:30000，密钥在 ~/.local/share/com.motrix.next/system.json
curl -s "http://localhost:30000/jsonrpc" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"aria2.addUri","params":["token:YOUR_SECRET", ["URL"], {"dir":"/path","out":"filename"}]}'
```

---

## 5. 构建步骤

### 7.1 快速构建（重用缓存）

```bash
cd ~/Work/codex-desktop-linux

export CODEX_MANAGED_NODE_SOURCE="$HOME/.local/share/mise/installs/node/24.17.0"
export CODEX_ELECTRON_ZIP_SOURCE="$HOME/.cache/codex-desktop/electron/electron-v42.1.0-linux-x64.zip"
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"

# 构建应用 + 打包 .deb
make build-app && make package
```

> `CODEX_MANAGED_NODE_SOURCE` 和 `CODEX_ELECTRON_ZIP_SOURCE` 是项目原生支持的 env var，不需要修改代码。

### 7.2 完整构建（从零开始）

```bash
make install-native
```

会依次执行：
1. `build-app` — 解包 DMG → 安装 npm 依赖 → 编译原生模块 → 打 Linux 补丁
2. `package` — 打包为 .deb/.rpm
3. `install` — 安装到系统

### 7.3 分步执行

| 步骤 | 命令 | 说明 |
|------|------|------|
| 解包 + 编译 | `make build-app` | 生成 `codex-app/` 目录 |
| 打包 | `make package` | 生成 `.deb` 到 `dist/` |
| 安装 | `sudo dpkg -i dist/*.deb` | 安装到系统 |
| 运行 | `./codex-app/start.sh` | 直接运行（不安装） |

### 7.4 网络差时避免重复下载

如果构建时网络不稳定（DNS 超时、下载中断），脚本会反复尝试重新下载 DMG。设置环境变量即可跳过远程检测：

```bash
# 跳过上游版本检查，直接使用本地缓存（即使网络不通）
export CODEX_DMG_FORCE_CACHE=1
make build-app
```

这个变量是项目原生的配置项（已提交到本 fork 的 `scripts/lib/dmg.sh`），不涉及代码修改。

## 6. 构建产物

| 产物 | 路径 | 大小 |
|------|------|------|
| Electron 应用目录 | `codex-app/` | ~500MB |
| .deb 包 | `dist/codex-desktop_*.deb` | ~328MB |
| 启动脚本 | `codex-app/start.sh` | — |

---

## 7. 常见问题

### 7.1 cargo 下载失败

```
error: failed to get `xxx` as a dependency
```

→ 检查 cargo 镜像配置是否正确，切换到 SJTUG sparse 镜像

### 7.2 Codex.dmg 重复下载

脚本每次执行 `--fresh` 时删除缓存。已修改 `Makefile` 中 `install-native` 使用 `build-app`（非 fresh）：
```bash
# 如要强制重新下载：
rm -f Codex.dmg.metadata && make build-app
```

### 7.3 Electron 版本不匹配

DMG 中包含的 Electron 版本可能变化，需下载对应的 Linux 版：
```bash
# 查看 DMG 中的 Electron 版本
grep -o '"version":"[^"]*"' codex-app/resources/app.asar.unpacked/node_modules/electron/package.json

# 下载对应版本
motrix-next download-add url="https://npmmirror.com/mirrors/electron/v<版本>/electron-v<版本>-linux-x64.zip"
```

### 7.4 启动找不到 Codex CLI

首次启动会提示 `Unable to locate the Codex CLI binary`，因为 Desktop 应用在 `resources/bin/codex` 中查找 CLI。

**解决方案一（推荐）：符号链接到 resources 目录**
```bash
sudo mkdir -p /opt/codex-desktop/resources/bin
sudo ln -sf $HOME/.local/share/mise/installs/npm-openai-codex/latest/bin/codex /opt/codex-desktop/resources/bin/codex
```

**解决方案二：环境变量（无需 sudo）**
```bash
CODEX_CLI_PATH=$(which codex) /opt/codex-desktop/start.sh
```

**解决方案三：直接安装到全局**
```bash
mise use --global npm:@openai/codex
```

### 7.5 Codex Desktop 启动后卡在加载界面

如果应用启动后一直显示加载界面，通常是两个原因：

1. **Codex CLI 未找到**（见 §7.4）
2. **Webview 服务未就绪** — 检查端口 5175 是否被占用：
   ```bash
   ss -tlnp | grep 5175
   pkill -f "webview-server.py"  # 杀掉残留进程后重试
   ```

应用正常启动后的进程链：
```
start.sh → webview-server.py (:5175) → electron → 界面显示
```

### 7.6 Browser Use 下载失败

构建过程中出现 `Downloading Browser Use node_repl fallback runtime` 卡住，是因为从 OpenAI CDN 下载大文件超时。

**不影响核心功能**，仅 `computer-use`（浏览器操控）相关插件不可用。Codex 本身的对话、代码编辑、终端功能一切正常。

**解决方案**：
```bash
# 用 motrix-next 多线程下载（aria2 + 16 线程）
BROWSER_USE_URL="https://persistent.oaistatic.com/codex-primary-runtime/26.426.12240/codex-primary-runtime-linux-x64-26.426.12240.tar.xz"
CACHE_DIR="$HOME/.cache/codex-desktop/browser-use"
mkdir -p "$CACHE_DIR"
curl -s "http://localhost:30000/jsonrpc" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"aria2.addUri\",\"params\":[\"token:\$(grep rpc-secret ~/.local/share/com.motrix.next/system.json | cut -d'\"' -f4)\", [\"$BROWSER_USE_URL\"], {\"dir\":\"$CACHE_DIR\",\"split\":\"16\"}]}"
```

下载完成后重新 `make build-app` 即可。

---

## 8. 参考

| 资源 | 链接 |
|------|------|
| 项目源码 | https://github.com/ilysenko/codex-desktop-linux |
| Codex 官方 | https://github.com/openai/codex |
| Codex Desktop 官网 | https://developers.openai.com/codex/app |
| 本机 Node 管理 | mise（`~/.local/share/mise/installs/node/24/bin`） |
| Electron 镜像 | https://npmmirror.com/mirrors/electron/ |
| cargo 镜像 | https://mirrors.sjtug.sjtu.edu.cn |
