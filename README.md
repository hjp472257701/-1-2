# CRTT 线上实验系统（研究二）

本项目提供一个可线上运行的数据收集系统，用于实现：
- 情景启动脚本 + 愤怒评分（1-9）
- 25 轮 Competitive Reaction Time Task（CRTT）
- 逐步升级的挑衅（对手在“你输”的试次里噪音强度从 2 升到 9）
- 逐 trial 保存数据到 SQLite，并支持导出 CSV（含 DV1/DV2 的计算结果）

## 本地运行

1) 安装依赖（已使用项目内缓存目录绕过本机 `~/.npm` 权限问题）：

```bash
NPM_CONFIG_CACHE="$(pwd)/.npm-cache" npm install
NPM_CONFIG_CACHE="$(pwd)/.npm-cache" npm --prefix server install
NPM_CONFIG_CACHE="$(pwd)/.npm-cache" npm --prefix web install
```

2) 启动（同时启动后端 + 前端）：

```bash
export EXPORT_TOKEN="set-a-long-random-token"
npm run dev
```

3) 访问：
- 前端：`http://localhost:5173`
- 健康检查：`http://localhost:3001/api/health`

## 数据导出

导出 CSV（需要 `EXPORT_TOKEN`）：

```text
/api/export.csv?token=EXPORT_TOKEN
```

也可以直接打开管理员下载页（更省事）：

```text
/admin
```

CSV 每行是一个 `session`，包含：
- `anger_rating`
- `md` / `cr`（可选：在 `/api/session/start` 传入，或后续你可扩展一个“导入研究一量表”的接口）
- `dv1_unprovoked`：第一次收到惩罚前（第一次 loss 之前）的平均惩罚 \(强度 × 秒\)
- `dv2_provoked`：第一次收到惩罚之后（第一次 loss 之后）的平均惩罚 \(强度 × 秒\)
- `trials_json`：该 session 的所有 trial 明细 JSON（方便复算/质控）

## 部署提示（最小化）

后端是标准 Node/Express 服务，环境变量：
- `PORT`：默认 3001
- `DB_PATH`：SQLite 文件路径（默认 `server/data.sqlite3`）
- `EXPORT_TOKEN`：导出保护令牌

前端通过 Vite 代理 `/api` 到后端；生产部署时可把前端构建产物交给任意静态托管，并把 `/api` 反代到后端即可。

## 自动化：推送代码 + 云端自动部署

**说明**：我无法代替你完成 GitHub 登录（涉及你的账号与令牌），但可以把你本地操作缩成一条命令，并让 GitHub 在每次推送后自动检查构建。

### 1）只做一次：保存 GitHub 登录（推荐 GitHub CLI）

```bash
brew install gh   # 若未安装
gh auth login
```

按提示用浏览器登录即可，之后 `git push` 一般不再需要每次输密码。

### 2）以后每次改完代码：一条命令提交并推送

```bash
cd "/Users/hujunpeng/Documents/cloude code"
npm run publish:github -- "说明这次改了什么"
```

等价于执行 `scripts/publish-github.sh`：自动 `git add` → `commit` → `push`。

### 3）云端「自动部署」（无需再点按钮）

在 **Render**、**Cloudflare Pages** 里把项目绑定到同一 GitHub 仓库后，**每次 push 到默认分支** 会自动触发重新构建/部署，无需额外脚本。

### 4）GitHub Actions：自动跑前端构建（CI）

仓库已包含 `.github/workflows/ci.yml`：向 `main` 推送或提 PR 时，会在云端执行 `web` 的 `npm ci && npm run build`，避免明显构建错误进主分支。

本地可先自检：

```bash
npm run ci
```

