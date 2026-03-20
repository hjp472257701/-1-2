#!/usr/bin/env bash
# 一键提交并推送到 GitHub（需先完成一次身份验证，见 README「自动化发布」）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "错误：当前目录不是 Git 仓库。"
  exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "错误：未配置 origin。请先: git remote add origin https://github.com/你的用户/仓库.git"
  exit 1
fi

if command -v gh >/dev/null 2>&1; then
  if ! gh auth status >/dev/null 2>&1; then
    echo "提示：检测到已安装 GitHub CLI，但未登录。执行一次即可长期免输密码："
    echo "  gh auth login"
    echo ""
  fi
fi

MSG="${1:-chore: update}"
BRANCH="$(git branch --show-current)"

git add -A
if git diff --staged --quiet; then
  echo "没有新的文件变更需要提交，仍将尝试 push（例如本地已有未推送的 commit）。"
else
  git commit -m "$MSG"
fi

git push -u origin "$BRANCH"
echo ""
echo "推送完成。若已在 Render / Cloudflare Pages 绑定本仓库，一般会随后自动部署。"
