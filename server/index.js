const express = require('express')
const cors = require('cors')
const { z } = require('zod')
const { customAlphabet } = require('nanoid')
const { stringify } = require('csv-stringify/sync')

const { db } = require('./db')

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12)

const app = express()
app.use(express.json({ limit: '200kb' }))
const corsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
app.use(
  cors({
    origin: corsOrigins.length ? corsOrigins : true,
    credentials: false,
  })
)

function nowIso() {
  return new Date().toISOString()
}

function clampInt(n, min, max) {
  const x = Number.isFinite(n) ? Math.trunc(n) : NaN
  if (!Number.isFinite(x)) return null
  return Math.min(max, Math.max(min, x))
}

function generateCrttPlan({ trials = 25 } = {}) {
  // Roughly 50% losses, with a first loss early to create a clear DV1 window.
  // We keep it deterministic per session by storing the plan in the client state;
  // server doesn't need it for scoring, but we include it so the UI can render.
  const outcomes = Array.from({ length: trials }, () => 'win')
  const lossCount = Math.floor(trials * 0.52) // 13 of 25

  // Ensure first loss at trial 3 (index 2). Then sample remaining loss trials with a hard
  // constraint: no 3 consecutive losses anywhere (better UX, still ~50% losses).
  const lossIdx = new Set([2])

  function wouldCreateThreeConsecutive(idx) {
    const has = (i) => lossIdx.has(i) || i === idx
    for (let start = idx - 2; start <= idx; start++) {
      if (start < 0 || start + 2 >= trials) continue
      if (has(start) && has(start + 1) && has(start + 2)) return true
    }
    return false
  }

  let guard = 0
  while (lossIdx.size < lossCount && guard < 20_000) {
    guard += 1
    // Bias picks slightly toward later trials so escalation "feels" natural.
    const idx = Math.min(trials - 1, Math.floor(Math.random() ** 0.65 * trials))
    if (idx < 2) continue
    if (idx === 2) continue
    if (lossIdx.has(idx)) continue
    if (wouldCreateThreeConsecutive(idx)) continue
    lossIdx.add(idx)
  }

  // Fallback: fill any remaining slots deterministically without breaking constraints.
  if (lossIdx.size < lossCount) {
    for (let i = 0; i < trials && lossIdx.size < lossCount; i++) {
      if (i < 2) continue
      if (i === 2) continue
      if (lossIdx.has(i)) continue
      if (wouldCreateThreeConsecutive(i)) continue
      lossIdx.add(i)
    }
  }

  for (const i of lossIdx) outcomes[i] = 'loss'

  // Opponent punishment escalates across loss trials from 2..9.
  const lossTrials = outcomes
    .map((o, i) => (o === 'loss' ? i : null))
    .filter((x) => x !== null)
  const opponentIntensities = lossTrials.map((_, k) => {
    const t = lossTrials.length <= 1 ? 0 : k / (lossTrials.length - 1)
    return clampInt(Math.round(2 + t * (9 - 2)), 1, 10)
  })

  const opponentDurationsMs = lossTrials.map((_, k) => {
    const t = lossTrials.length <= 1 ? 0 : k / (lossTrials.length - 1)
    return clampInt(Math.round((500 + t * (3500 - 500)) / 100) * 100, 0, 5000)
  })

  const plan = outcomes.map((outcome, i) => {
    const lossK = lossTrials.indexOf(i)
    return {
      trialIndex: i,
      outcome,
      opponent: outcome === 'loss'
        ? {
            intensity: opponentIntensities[lossK],
            durationMs: opponentDurationsMs[lossK],
          }
        : null,
    }
  })
  return plan
}

app.get('/api/health', (_req, res) => res.json({ ok: true, time: nowIso() }))

app.get('/admin', (_req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.send(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>CRTT 数据导出</title>
    <style>
      :root { color-scheme: light dark; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
      body { margin: 0; background: #0b0b0f10; }
      .wrap { max-width: 720px; margin: 28px auto; padding: 0 16px; }
      .card { background: rgba(255,255,255,0.7); border: 1px solid rgba(120,120,140,0.25); border-radius: 14px; padding: 16px; backdrop-filter: blur(8px); }
      @media (prefers-color-scheme: dark) {
        .card { background: rgba(25,25,32,0.7); }
      }
      h1 { margin: 0 0 8px; font-size: 20px; }
      p { margin: 0 0 12px; opacity: 0.85; line-height: 1.5; }
      label { display: grid; gap: 6px; margin: 10px 0 12px; }
      input { padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(120,120,140,0.35); background: rgba(0,0,0,0.04); }
      button { padding: 10px 12px; border-radius: 12px; border: 1px solid rgba(120,120,140,0.35); background: rgba(140,90,255,0.12); cursor: pointer; font-weight: 650; }
      .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
      a.btn { text-decoration: none; color: inherit; }
      .hint { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; opacity: 0.85; }
      .err { margin-top: 10px; color: #b91c1c; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>CRTT 数据导出（管理员）</h1>
        <p>输入 <span class="hint">EXPORT_TOKEN</span>，即可一键下载汇总 CSV（含 DV1/DV2 与 trials 明细 JSON）。</p>
        <label>
          <div>导出口令（EXPORT_TOKEN）</div>
          <input id="token" type="password" placeholder="粘贴你的 EXPORT_TOKEN" />
        </label>
        <div class="row">
          <button id="save">保存口令</button>
          <a id="download" class="btn" href="#"><button type="button">下载 CSV</button></a>
          <button id="clear" type="button">清除本地口令</button>
        </div>
        <div id="err" class="err" style="display:none"></div>
        <p style="margin-top:12px" class="hint">导出接口：/api/export.csv?token=EXPORT_TOKEN</p>
      </div>
    </div>
    <script>
      const key = 'crtt_export_token'
      const $token = document.getElementById('token')
      const $download = document.getElementById('download')
      const $err = document.getElementById('err')
      function setErr(msg) {
        if (!msg) { $err.style.display='none'; $err.textContent=''; return }
        $err.style.display='block'; $err.textContent = msg
      }
      function refresh() {
        const t = ($token.value || '').trim()
        $download.href = '/api/export.csv?token=' + encodeURIComponent(t)
      }
      $token.value = (localStorage.getItem(key) || '')
      refresh()
      $token.addEventListener('input', refresh)
      document.getElementById('save').addEventListener('click', () => {
        localStorage.setItem(key, ($token.value || '').trim())
        setErr('')
        refresh()
      })
      document.getElementById('clear').addEventListener('click', () => {
        localStorage.removeItem(key)
        $token.value = ''
        setErr('')
        refresh()
      })
      $download.addEventListener('click', async (e) => {
        setErr('')
        const url = $download.href
        // Preflight check to give nicer error than downloading HTML "unauthorized".
        try {
          const r = await fetch(url, { method: 'GET' })
          if (!r.ok) {
            e.preventDefault()
            setErr('导出失败：口令错误或未设置（HTTP ' + r.status + '）。')
          }
        } catch (err) {
          e.preventDefault()
          setErr('导出失败：网络错误。')
        }
      })
    </script>
  </body>
</html>`)
})

app.post('/api/session/start', (req, res) => {
  const schema = z.object({
    participantId: z.string().min(1).max(64),
    // Optional: if you want to import MD/CR later, you can omit these.
    md: z.number().finite().optional(),
    cr: z.number().finite().optional(),
    userAgent: z.string().max(512).optional(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { participantId, md, cr, userAgent } = parsed.data
  const sessionId = nanoid()

  const upsertParticipant = db.prepare(`
    insert into participants (participant_id, md, cr)
    values (@participant_id, @md, @cr)
    on conflict(participant_id) do update set
      md = coalesce(excluded.md, participants.md),
      cr = coalesce(excluded.cr, participants.cr)
  `)
  upsertParticipant.run({ participant_id: participantId, md: md ?? null, cr: cr ?? null })

  db.prepare(
    `insert into sessions (session_id, participant_id, user_agent) values (?, ?, ?)`
  ).run(sessionId, participantId, userAgent ?? null)

  const plan = generateCrttPlan({ trials: 25 })
  res.json({ sessionId, plan })
})

app.post('/api/session/hook', (req, res) => {
  const schema = z.object({
    sessionId: z.string().min(6).max(32),
    hookReadStartedAt: z.string().datetime().optional(),
    hookReadEndedAt: z.string().datetime().optional(),
    angerRating: z.number().int().min(1).max(9),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { sessionId, hookReadStartedAt, hookReadEndedAt, angerRating } = parsed.data
  const r = db
    .prepare(
      `update sessions
       set hook_read_started_at = coalesce(?, hook_read_started_at),
           hook_read_ended_at = coalesce(?, hook_read_ended_at),
           anger_rating = ?
       where session_id = ?`
    )
    .run(hookReadStartedAt ?? null, hookReadEndedAt ?? null, angerRating, sessionId)

  if (r.changes === 0) return res.status(404).json({ error: 'session_not_found' })
  res.json({ ok: true })
})

app.post('/api/trial', (req, res) => {
  const schema = z.object({
    sessionId: z.string().min(6).max(32),
    trialIndex: z.number().int().min(0).max(24),
    outcome: z.enum(['win', 'loss']),
    participantRtMs: z.number().int().min(50).max(10000).nullable().optional(),
    participantIntensity: z.number().int().min(1).max(10),
    participantDurationMs: z.number().int().min(0).max(5000),
    opponentIntensity: z.number().int().min(1).max(10).nullable().optional(),
    opponentDurationMs: z.number().int().min(0).max(5000).nullable().optional(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const t = parsed.data
  const stmt = db.prepare(`
    insert into trials (
      session_id, trial_index, outcome, participant_rt_ms,
      participant_intensity, participant_duration_ms,
      opponent_intensity, opponent_duration_ms
    ) values (?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(session_id, trial_index) do update set
      outcome = excluded.outcome,
      participant_rt_ms = excluded.participant_rt_ms,
      participant_intensity = excluded.participant_intensity,
      participant_duration_ms = excluded.participant_duration_ms,
      opponent_intensity = excluded.opponent_intensity,
      opponent_duration_ms = excluded.opponent_duration_ms
  `)
  stmt.run(
    t.sessionId,
    t.trialIndex,
    t.outcome,
    t.participantRtMs ?? null,
    t.participantIntensity,
    t.participantDurationMs,
    t.opponentIntensity ?? null,
    t.opponentDurationMs ?? null
  )
  res.json({ ok: true })
})

app.post('/api/session/complete', (req, res) => {
  const schema = z.object({ sessionId: z.string().min(6).max(32) })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const { sessionId } = parsed.data

  const r = db
    .prepare(`update sessions set completed_at = ? where session_id = ?`)
    .run(nowIso(), sessionId)
  if (r.changes === 0) return res.status(404).json({ error: 'session_not_found' })
  res.json({ ok: true })
})

function computeDv(trials) {
  const firstLossIndex = trials.findIndex((t) => t.outcome === 'loss')
  const pre = firstLossIndex === -1 ? trials : trials.slice(0, firstLossIndex)
  const post = firstLossIndex === -1 ? [] : trials.slice(firstLossIndex + 1)

  const score = (t) => t.participant_intensity * (t.participant_duration_ms / 1000)
  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + score(b), 0) / arr.length : null)

  return {
    firstLossIndex: firstLossIndex === -1 ? null : firstLossIndex,
    dv1_unprovoked: mean(pre),
    dv2_provoked: mean(post),
  }
}

app.get('/api/export.csv', (req, res) => {
  const token = req.query.token
  if (!process.env.EXPORT_TOKEN || token !== process.env.EXPORT_TOKEN) {
    return res.status(401).send('unauthorized')
  }

  const sessions = db
    .prepare(
      `select s.*, p.md as md, p.cr as cr
       from sessions s join participants p on p.participant_id = s.participant_id
       order by s.started_at asc`
    )
    .all()

  const trialStmt = db.prepare(
    `select * from trials where session_id = ? order by trial_index asc`
  )

  const rows = []
  for (const s of sessions) {
    const trials = trialStmt.all(s.session_id)
    const dv = computeDv(trials)
    rows.push({
      participant_id: s.participant_id,
      session_id: s.session_id,
      started_at: s.started_at,
      completed_at: s.completed_at,
      anger_rating: s.anger_rating,
      md: s.md,
      cr: s.cr,
      first_loss_index: dv.firstLossIndex,
      dv1_unprovoked: dv.dv1_unprovoked,
      dv2_provoked: dv.dv2_provoked,
      trials_json: JSON.stringify(trials),
    })
  }

  const csv = stringify(rows, { header: true })
  res.setHeader('content-type', 'text/csv; charset=utf-8')
  res.send(csv)
})

const PORT = Number(process.env.PORT || 3001)
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`CRTT server listening on http://localhost:${PORT}`)
})

