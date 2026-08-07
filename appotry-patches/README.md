# appotry 自定义补丁目录

本目录承载本 fork 相对上游 [ilysenko/codex-desktop-linux](https://github.com/ilysenko/codex-desktop-linux) 的所有自定义改动。

## 设计原则（方案 B：上游为基线 + 补丁目录）

- **上游仓库是基线**：`main` 分支完全跟随上游，不修改任何上游文件。
- **我们的改动集中在 `appotry-patches/`**：GitHub Actions 只认 `.github/workflows/` 下的 workflow，所以真实文件仍需出现在对应位置——由 `apply.sh` 负责复制。
- **更新流程**：上游发布新版本后，`main` 自动同步（fork sync），本地执行：

```bash
# 1. 拉取上游最新
git fetch origin

# 2. 以最新上游为基线重建 releases 分支
git checkout -B releases origin/main

# 3. 应用我们的补丁
bash appotry-patches/apply.sh

# 4. 提交并推送
git add -A
git commit -m "chore: apply appotry patches on upstream <SHA>"
git push appotry releases
```

## 补丁清单

| 源文件 | 目标位置 | 说明 |
|--------|---------|------|
| `workflows/auto-build.yml` | `.github/workflows/auto-build.yml` | 自动构建 .deb/.rpm/AppImage 并发布 Release |
| `workflows/sync-upstream.yml` | `.github/workflows/sync-upstream.yml` | 定时拉取上游并合并到 releases（每 6 小时） |
| `docs/LOCAL-BUILD.zh.md` | `docs/LOCAL-BUILD.zh.md` | 中文构建指南（国内镜像、GitHub Release 安装说明） |

## 自动同步 + 自动构建流程

```
上游发布新版本
    │
    ▼
sync-upstream.yml (schedule 每 6h)
    ├─ fetch upstream main
    ├─ merge 到 releases（无冲突，补丁文件上游不存在）
    ├─ apply.sh 重新应用补丁
    └─ push releases
            │
            ▼
auto-build.yml (push 触发)
    ├─ 构建 .deb / .rpm / .pkg.tar.zst / .AppImage
    └─ 发布 GitHub Release
```

> **重要**：不要在 GitHub 网页上使用 "Sync fork" 按钮。它会把上游合并到
> 默认分支（`releases`），与补丁冲突。请使用 `sync-upstream.yml` 或手动执行
> 下面的更新流程。

## 命令

```bash
bash appotry-patches/apply.sh          # 应用所有补丁（复制到目标位置）
bash appotry-patches/apply.sh --check  # 检查补丁是否已应用
```
