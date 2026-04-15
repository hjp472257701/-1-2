# CRTT 线上实验系统（研究二）

本项目提供一个可线上运行的数据收集系统。被试端**同工不同酬脚本**与**反应时+白噪音任务的操作说明**与实验室方案一致；界面**标题/页脚**不显示 CRTT 等范式缩写以降低要求特征。数据库字段名为 `anger_rating`、`md`、`cr` 等。用于实现：
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

2) 配置后端环境变量（二选一）：

```bash
cp server/.env.example server/.env
# 编辑 server/.env，至少填写 EXPORT_TOKEN；本地开发可保留 DB_PATH=./data.sqlite3
```

或仅在当前终端导出：`export EXPORT_TOKEN="set-a-long-random-token"`（未创建 `server/.env` 时）。

3) 启动（同时启动后端 + 前端）：

```bash
npm run dev
```

4) 访问：
- 前端：`http://localhost:5173`
- 健康检查：`http://localhost:3001/api/health`

## 数据导出

导出 CSV（需要 `EXPORT_TOKEN`）：

```text
/api/export.csv?token=EXPORT_TOKEN
/api/export_trials.csv?token=EXPORT_TOKEN
/api/export_research1.csv?token=EXPORT_TOKEN
/api/export_merged.csv?token=EXPORT_TOKEN
```

也可以直接打开管理员下载页（更省事）：

```text
/admin
```

`/api/export.csv` 为研究二被试级导出（每行一个 CRTT session）：

| 列名 | 通俗含义 |
|------|----------|
| `participant_id` | 被试当时填的编号 |
| `session_id` | 系统自动生成的本场次 ID（防重复、查日志用） |
| `invite_token` | 若用邀请链接进入，这里有令牌；没用链接则多为空 |
| `started_at` | 点「开始」进入实验的时间 |
| `completed_at` | 做完 25 轮点结束的时间；空 = 可能中途退出 |
| `anger_rating` | 任务一里「有多生气」1–9 分 |
| `md` / `cr` | 研究一中的 PMD/ERQ-CR 分数（问卷提交后自动写入） |
| `dv1_trial_start` / `dv1_trial_end` / `dv1_n` | 无挑衅窗口（固定 trial 1-5）及有效 trial 数 |
| `dv1_unprovoked` | 无挑衅攻击指标（trial 1-5 的惩罚均值） |
| `dv2_trial_start` / `dv2_trial_end` / `dv2_n` | 挑衅窗口（固定 trial 6-25）及有效 trial 数 |
| `dv2_provoked` | 反应性攻击指标（trial 6-25 的惩罚均值） |
| `trials_json` | **25 轮每一笔**的明细，一个单元格里是一整段 JSON 文本 |

**`trials_json` 里每一条**大致对应：`trial_index`（第几轮 0–24）、`outcome`（`win`/`loss` 相对被试）、`participant_rt_ms`（按空格的反应毫秒）、`participant_intensity` / `participant_duration_ms`（被试为对方设的响度与时长）、`opponent_intensity` / `opponent_duration_ms`（本轮若被试输，程序施加的惩罚参数）。用 Excel 看 JSON 不便时，可复制到 [jsonformatter.org](https://jsonformatter.org) 或导入 R/Python 解析。

`/api/export_research1.csv` 为研究一问卷导出（每行一个问卷会话），含人口学与 PRDS/PMD/AQ/ERQ-CR。  
`/api/export_merged.csv` 为研究一+研究二合并导出（按 `participant_id` 关联）。

## 给被试发链接（邀请链接）

典型流程：**管理员页生成链接 → 发给被试 → 被试在浏览器完成实验 → 你导出 CSV**。

1. 打开后端上的管理员页：`https://你的API域名/admin`（本地为 `http://localhost:3001/admin`）。
2. 填写 `EXPORT_TOKEN`，在「生成被试邀请链接」里填写**前端公网地址**（与发给被试打开的页面一致，例如 Cloudflare Pages 的 `https://xxx.pages.dev`）。
3. 可选填写「被试 ID」：留空则被试自己输入；填写则链接打开后**锁定**为该 ID。
4. 点击生成，复制完整链接发给被试。

被试打开的地址形如：

```text
https://你的前端域名/?invite=xxxxxxxxxxxxxxxxxx
```

也可使用短参数：`?i=同一串令牌`（与 `?invite=` 等价）。

后端环境变量（可选）：

- `PUBLIC_WEB_URL`：与前端公网地址相同（不要末尾 `/`）。设置后，`POST /api/admin/invites` 的 JSON 响应里会直接带上 `fullUrl`，方便脚本或自动化使用。

公开接口（被试浏览器会调用）：

- `GET /api/invite/:token`：校验邀请是否有效，并返回是否锁定被试 ID。

### 研究一（问卷）与研究二（本任务）分开展施测

本仓库现已支持：

- 研究一问卷：`/questionnaire`
- 研究二任务：`/`

两者可分开完成，不要求同一天。数据上通过 **相同 participant_id** 自动对齐。

**被试编号（最重要）**  
在研究一中为每位被试分配或让其记住的 ID，在研究二登录页填写**完全相同**的编号。若使用邀请链接，可在 `/admin` 生成链接时**锁定**该编号，减少填错。

**研究一中的量表分（如 MD/CR）**  
问卷在 `/questionnaire` 提交后会自动计算并写入，不需要再手动录入。

**发放研究二链接的时机（与研究一非同时）**  
常见做法：研究一结束后**另行**通过邮件/微信/群公告发送研究二链接（或一人一链），说明「请在与研究一**相同编号**下完成」。不要求被试在答问卷当下立刻点开 CRTT。

**若问卷平台仍提供「跳转 URL」功能（可选）**  
仅当你希望从研究一**当场**跳转到研究二时使用；分开展施测时多数团队**不用跳转**，只发独立链接即可。若使用跳转，可把作答编号拼进 URL 预填「被试 ID」。前端按顺序识别：

- `pid`
- `participant_id`
- `rid`
- `response_id`

示例（花括号内换成平台可插入的字段）：

```text
https://你的前端域名/?pid={研究一中使用的被试或作答ID}
https://你的前端域名/?invite=邀请令牌&pid={作答ID}
```

若邀请链接已锁定被试 ID，则无需再传 `pid`。

**给被试的说明文案示例（研究二单独发放时）**  
「感谢完成研究一。请在方便时使用电脑打开以下链接完成研究二（约 15–20 分钟），浏览器请用 **Chrome 或 Edge**，需键盘与声音；**请勿使用手机**。登录时请填写与**研究一相同**的被试编号。」

**伦理**  
研究一问卷中的知情同意、报酬等已覆盖的部分，研究二页面仍保留简要同意勾选；具体以伦理批件为准。

## 量表导入接口（研究一 MD/CR，兼容保留）

如你已有外部问卷平台数据，仍可在本任务开始前按 `participantId` 写入 MD/CR。该接口与问卷平台并行保留：

```text
POST /api/participant/scales
content-type: application/json
{
  "participantId": "S0123",
  "md": 3.25,
  "cr": 4.1
}
```

说明：
- `md` / `cr` 可选，支持单独更新其中一个字段。
- 同一 `participantId` 会自动 upsert（存在则更新，不存在则创建）。

## 网络发布与收数（推荐：Render 单服务）

当前实现为 **同一公网地址** 同时提供：

- 被试打开的 **研究一问卷页面**（`/questionnaire`）
- 被试打开的 **研究二实验页面**（`/`）
- **API**（`/api/...`）
- 管理页 **`/admin`**（导出研究一/研究二/合并 CSV、生成研究二邀请链接）

构建时先把 `web` 打成 `web/dist`，生产环境下 **Node 会托管该目录**；被试请求仍走相对路径 `/api`，无需配置 `VITE_API_BASE`。

### Render 部署步骤

1. 把代码推到 GitHub。
2. 打开 [Render](https://render.com) → **New** → **Blueprint** → 选择本仓库 → 确认使用根目录的 `render.yaml`。
3. 创建时务必挂上 **Disk**（蓝图里已写 `crtt-data` → `/var/data`），否则 SQLite 数据在重部署后会丢。
4. 部署完成后，在 Render 面板查看服务 URL（例如 `https://crtt-api.onrender.com`），把该地址发给被试即可访问实验。
5. 在 **Environment** 里复制自动生成的 **`EXPORT_TOKEN`**；打开 `https://你的服务域名/admin` 下载数据或生成邀请链接。
6. （可选）设置 **`PUBLIC_WEB_URL`** = 与上面服务 URL 完全一致（不要末尾 `/`），便于管理页生成完整邀请链接。

免费实例冷启动较慢，正式收数可考虑付费档或提醒被试首次多等几秒。

### 不想用 Render / 绑卡不成功时

**A）任意云服务器 + Docker（常用、支付方式多）**  
很多国内/海外厂商的「轻量应用服务器」支持**微信/支付宝或对公转账**，不必依赖 Render 绑国际信用卡。

1. 买一台最小配置 Linux（Ubuntu 22.04 等），安全组/防火墙**放行 3001**（或你映射的端口）。
2. 安装 Docker 与 Docker Compose。
3. 把本仓库拷到服务器（`git clone` 或上传）。
4. 在仓库根目录：

```bash
cp .env.example .env
# 编辑 .env，至少设置 EXPORT_TOKEN

docker compose up -d --build
```

5. 浏览器访问 `http://服务器公网IP:3001`，`/admin` 同上。数据在 Docker 卷 `crtt-data` 里，**备份该卷或定期下载 CSV**。

**B）本机运行 + Cloudflare Tunnel（不租服务器、预实验）**  
适合**小规模试测**：电脑开着服务，用免费隧道临时给出公网链接，**一般不需要在 Cloudflare 绑卡**（仅需注册账号做隧道授权）。

1. 本机：`npm run build && export EXPORT_TOKEN="你的口令" && npm start`（端口 3001）。
2. 安装 [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/) 后执行：

```bash
cloudflared tunnel --url http://localhost:3001
```

终端里会出现 `https://xxxx.trycloudflare.com` 一类地址，**发给被试即可**；你关机或关终端后链接失效。正式收数仍建议用长期在线的 VPS + Docker。

**隧道是否稳定？多人同时做会不会把服务弄崩？**

- **Cloudflare 侧**：Quick Tunnel（`--url` 临时域名）走的是 Cloudflare 正式隧道基础设施，一般**不会因为「多几个人同时打开网页」就整体瘫痪**；更常见的不稳定来自**你本机关机、合盖睡眠、断网、换 Wi‑Fi** 或 **cloudflared 进程被关掉**。
- **本机程序侧**：Node + Express 同时处理多名被试的常规请求（读情景、提交 trial、写 SQLite）在**小规模并发**（例如同时在线十余人、每人 25 轮逐步提交）下通常**不会单纯因为并发而崩溃**。数据库已开 **WAL**，短事务下并发写一般会排队完成，极端情况下可能出现个别请求**稍慢或偶发失败**（页面重试或损失单条 trial 的风险），而不是整进程「炸掉」。
- **真正的瓶颈**往往是：家用宽带的**上行带宽**、电脑长期高负载、或 SQLite 在**极高并发写**下的锁等待。若预计**同时大量被试**或需要 **7×24 收数**，仍更稳妥用 **VPS + Docker**（或云数据库方案），不要把研究完全押在一台会睡眠的个人电脑上。

**C）其他 PaaS（自行查看是否需绑卡）**  
例如 [Zeabur](https://zeabur.com)、[Koyeb](https://www.koyeb.com) 等，支持从 GitHub 部署容器；若提供 Dockerfile，可将本仓库按「Docker 部署」思路接入。是否免卡、是否持久盘以各平台说明为准。

仓库根目录已提供 **`Dockerfile`**、**`docker-compose.yml`**、**`.env.example`**，与 Render 使用同一套 Node 托管 `web/dist` 的逻辑。

### 本地模拟生产（自检）

```bash
cd "/Users/hujunpeng/Documents/cloude code"
npm run build
export EXPORT_TOKEN="local-test"
npm start
```

浏览器访问 `http://localhost:3001`（页面）与 `http://localhost:3001/api/health`。

**若浏览器打开 `/api/health` 显示 404 或 “invalid response”：**

1. 确认终端里**正在运行**的是 `npm start`（或 `node server/index.js`），且日志里有 `listening on port 3001`，**不要**只用 `vite preview` / `npx serve` 等只托管 `dist` 的命令占 3001——那样没有 `/api`，必 404。
2. 先执行过 **`npm run build`**，再 `npm start`（与线上一致）。
3. 另开一个终端执行：`curl -s http://127.0.0.1:3001/api/health`  
   - 若这里有 JSON，而浏览器不行：检查是否用了 **https://** 访问（应使用 **http://**），或关闭代理/VPN 再试。  
   - 若 curl 也是 404：执行 `lsof -i :3001` 看 3001 上是不是别的程序，关掉后重新 `npm start`。

### 环境变量说明

| 变量 | 说明 |
|------|------|
| `PORT` | 监听端口（Render 上一般为 10000） |
| `DB_PATH` | SQLite 路径；生产建议 `/var/data/data.sqlite3` |
| `EXPORT_TOKEN` | 导出 CSV、创建邀请链接等管理操作口令 |
| `PUBLIC_WEB_URL` | 可选；与对外访问的根 URL 一致，便于生成邀请链接 |
| `CORS_ORIGIN` | **仅当**前端与 API 不同域名时填写，英文逗号分隔 |

### 前端单独托管（可选）

若你把 `web/dist` 放到 Cloudflare Pages / Netlify 等，需在构建时设置 **`VITE_API_BASE`** = API 根地址，并在后端配置 **`CORS_ORIGIN`** 为前端域名。仓库内 `web/public/_redirects` 已为 SPA 准备 **`/* → /index.html`**（Cloudflare Pages 兼容）。

说明：界面中关于「1–10 级约对应 60–105 dB」的表述来自实验方案说明；浏览器播放未做声学标定，**分析时建议以等级与时长为主**，线下实验室若需严格 dB 需另行校准设备与程序。

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

