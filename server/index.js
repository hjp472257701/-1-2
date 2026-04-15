const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '.env') })
const fs = require('fs')
const express = require('express')
const cors = require('cors')
const { z } = require('zod')
const { customAlphabet } = require('nanoid')
const { stringify } = require('csv-stringify/sync')

const { db } = require('./db')
const { questionnaireSchema, getAllScaleItems } = require('./questionnaireSchema')

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12)
const inviteNanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 18)
const questionnaireNanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12)
const CRTT_TOTAL_TRIALS = 25
const CRTT_BASELINE_TRIALS = 5
const Q1_REQUIRED_ITEM_COUNT = getAllScaleItems().length
const Q1_MAX_MISSING_RECOMMENDED = Math.floor(Q1_REQUIRED_ITEM_COUNT * 0.2)
const Q1_MIN_DURATION_MS_RECOMMENDED = 3 * 60 * 1000
const Q1_ITEM_INDEX = new Map(
  getAllScaleItems().map((item) => [
    item.id,
    {
      id: item.id,
      scaleId: item.scaleId,
      reverse: item.reverse,
      min: questionnaireSchema.scales.find((s) => s.id === item.scaleId)?.min ?? 1,
      max: questionnaireSchema.scales.find((s) => s.id === item.scaleId)?.max ?? 5,
    },
  ])
)

function readExportToken(req) {
  const auth = String(req.get('authorization') || '')
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  const body = req.body && typeof req.body === 'object' ? req.body.exportToken : undefined
  const q = typeof req.query?.token === 'string' ? req.query.token : ''
  return bearer || (typeof body === 'string' ? body : '') || q
}

function requireExportToken(req, res) {
  const t = readExportToken(req)
  if (!process.env.EXPORT_TOKEN || t !== process.env.EXPORT_TOKEN) {
    res.status(401).json({ error: 'unauthorized' })
    return null
  }
  return t
}

function inviteExpiredRow(row) {
  if (!row?.expires_at) return false
  return new Date(row.expires_at).getTime() <= Date.now()
}

function inviteSelectable(row) {
  if (!row) return { ok: false, code: 'not_found' }
  if (inviteExpiredRow(row)) return { ok: false, code: 'expired' }
  if (row.use_count >= row.max_uses) return { ok: false, code: 'exhausted' }
  return { ok: true }
}

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
syncQuestionnaireItems()

function nowIso() {
  return new Date().toISOString()
}

function clampInt(n, min, max) {
  const x = Number.isFinite(n) ? Math.trunc(n) : NaN
  if (!Number.isFinite(x)) return null
  return Math.min(max, Math.max(min, x))
}

function scoreReverse(value, min, max) {
  return min + max - value
}

function mean(values) {
  if (!values.length) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

function sum(values) {
  if (!values.length) return null
  return values.reduce((a, b) => a + b, 0)
}

function aggregate(values, method) {
  return method === 'sum' ? sum(values) : mean(values)
}

function evaluateQuestionnaireQuality(row) {
  const attentionFailed = Number(row.attention_passed ?? 1) !== 1
  const tooManyMissing = Number(row.missing_count ?? 0) > Q1_MAX_MISSING_RECOMMENDED
  const tooFast = Number(row.duration_ms ?? 0) > 0 && Number(row.duration_ms) < Q1_MIN_DURATION_MS_RECOMMENDED
  const socialFlag = Number(row.soft_social_flag ?? 0) === 1
  const conflictFlag = Number(row.soft_conflict_flag ?? 0) === 1

  if (attentionFailed || tooManyMissing || tooFast) {
    return { response_quality_level: 'exclude', exclude_recommended: 1 }
  }
  if (socialFlag || conflictFlag) {
    return { response_quality_level: 'suspicious', exclude_recommended: 1 }
  }
  return { response_quality_level: 'valid', exclude_recommended: 0 }
}

function scoreQuestionnaire(answersByItem) {
  const out = {}
  for (const scale of questionnaireSchema.scales) {
    const values = []
    const normalized = new Map()
    for (const item of scale.items) {
      const raw = answersByItem.get(item.id)
      if (typeof raw !== 'number') continue
      const v = scale.reverseItems.includes(item.id)
        ? scoreReverse(raw, scale.min, scale.max)
        : raw
      values.push(v)
      normalized.set(item.id, v)
    }
    out[scale.id] = aggregate(values, scale.scoring?.method || 'mean')

    if (scale.id === 'AQ' && scale.scoring?.subscales) {
      for (const [subName, ids] of Object.entries(scale.scoring.subscales)) {
        const subValues = ids
          .map((id) => normalized.get(id))
          .filter((v) => typeof v === 'number')
        out[`AQ_${subName}`] = aggregate(subValues, scale.scoring?.method || 'mean')
      }
    }
  }
  return out
}

function syncQuestionnaireItems() {
  const upsert = db.prepare(`
    insert into questionnaire_items (item_id, scale_id, item_text, reverse_scored)
    values (?, ?, ?, ?)
    on conflict(item_id) do update set
      scale_id = excluded.scale_id,
      item_text = excluded.item_text,
      reverse_scored = excluded.reverse_scored
  `)
  const tx = db.transaction(() => {
    for (const scale of questionnaireSchema.scales) {
      for (const item of scale.items) {
        upsert.run(item.id, scale.id, item.text, scale.reverseItems.includes(item.id) ? 1 : 0)
      }
    }
  })
  tx()
}

function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function generateCrttPlan({ trials = CRTT_TOTAL_TRIALS } = {}) {
  // Block design to reduce confound:
  // - Baseline block: fixed early trials with no provocation (all wins)
  // - Provocation block: ~50% losses, but loss intensities are randomized (non-monotonic)
  const outcomes = Array.from({ length: trials }, () => 'win')
  const baselineEnd = Math.min(CRTT_BASELINE_TRIALS, trials)
  const provocationIndices = Array.from({ length: Math.max(0, trials - baselineEnd) }, (_, k) => baselineEnd + k)

  const lossCount = Math.floor(provocationIndices.length * 0.5)
  const chosenLosses = shuffle(provocationIndices).slice(0, lossCount)
  for (const i of chosenLosses) outcomes[i] = 'loss'

  const lossTrials = outcomes.map((o, i) => (o === 'loss' ? i : null)).filter((x) => x !== null)

  // Randomized provocation profiles (not tied to trial order).
  const intensityPool = [2, 3, 4, 5, 6, 7, 8, 9]
  const durationPool = [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000]
  const opponentProfiles = lossTrials.map((_, k) => ({
    intensity: intensityPool[k % intensityPool.length],
    durationMs: durationPool[k % durationPool.length],
  }))
  const randomizedProfiles = shuffle(opponentProfiles)

  const plan = outcomes.map((outcome, i) => {
    const lossK = lossTrials.indexOf(i)
    return {
      trialIndex: i,
      outcome,
      opponent: outcome === 'loss'
        ? {
            intensity: clampInt(randomizedProfiles[lossK].intensity, 1, 10),
            durationMs: clampInt(randomizedProfiles[lossK].durationMs, 0, 5000),
          }
        : null,
    }
  })
  return plan
}

function healthHandler(_req, res) {
  res.json({ ok: true, time: nowIso() })
}
app.get('/api/health', healthHandler)
app.get('/api/health/', healthHandler)

app.get('/api/q1/schema', (_req, res) => {
  res.json({
    ok: true,
    schema: questionnaireSchema,
    requiredItemCount: Q1_REQUIRED_ITEM_COUNT,
  })
})

app.post('/api/q1/session/start', (req, res) => {
  const schema = z.object({
    participantId: z.string().min(1).max(64),
    userAgent: z.string().max(512).optional(),
  })
  const parsed = schema.safeParse(req.body || {})
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const participantId = parsed.data.participantId.trim()
  const questionnaireSessionId = questionnaireNanoid()
  const upsertParticipant = db.prepare(`
    insert into participants (participant_id, md, cr)
    values (?, null, null)
    on conflict(participant_id) do nothing
  `)
  const completedCount = db
    .prepare(
      `select count(1) as c from questionnaire_sessions where participant_id = ? and completed_at is not null`
    )
    .get(participantId)?.c
  const completedOnce = completedCount > 0 ? 0 : 1

  db.transaction(() => {
    upsertParticipant.run(participantId)
    db.prepare(
      `insert into questionnaire_sessions
      (questionnaire_session_id, participant_id, schema_version, user_agent, completed_once)
      values (?, ?, ?, ?, ?)`
    ).run(
      questionnaireSessionId,
      participantId,
      questionnaireSchema.version,
      parsed.data.userAgent ?? null,
      completedOnce
    )
  })()

  res.json({ ok: true, questionnaireSessionId, schemaVersion: questionnaireSchema.version })
})

app.post('/api/q1/answers', (req, res) => {
  const schema = z.object({
    questionnaireSessionId: z.string().min(6).max(32),
    participantId: z.string().min(1).max(64),
    answers: z
      .array(
        z.object({
          itemId: z.string().min(2).max(32),
          value: z.number().finite(),
        })
      )
      .min(1),
  })
  const parsed = schema.safeParse(req.body || {})
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { questionnaireSessionId, participantId, answers } = parsed.data
  const session = db
    .prepare(
      `select questionnaire_session_id, participant_id, completed_at from questionnaire_sessions where questionnaire_session_id = ?`
    )
    .get(questionnaireSessionId)
  if (!session) return res.status(404).json({ error: 'questionnaire_session_not_found' })
  if (session.participant_id !== participantId) return res.status(403).json({ error: 'participant_mismatch' })
  if (session.completed_at) return res.status(409).json({ error: 'questionnaire_already_completed' })

  const upsertAnswer = db.prepare(`
    insert into questionnaire_answers
    (questionnaire_session_id, participant_id, scale_id, item_id, answer_value)
    values (?, ?, ?, ?, ?)
    on conflict(questionnaire_session_id, item_id) do update set
      answer_value = excluded.answer_value,
      scale_id = excluded.scale_id
  `)

  try {
    db.transaction(() => {
      for (const answer of answers) {
        const item = Q1_ITEM_INDEX.get(answer.itemId)
        if (!item) {
          const err = new Error('invalid_item')
          err.code = 'invalid_item'
          throw err
        }
        if (answer.value < item.min || answer.value > item.max) {
          const err = new Error('invalid_value_range')
          err.code = 'invalid_value_range'
          throw err
        }
        upsertAnswer.run(
          questionnaireSessionId,
          participantId,
          item.scaleId,
          item.id,
          answer.value
        )
      }
    })()
  } catch (e) {
    if (e.code === 'invalid_item' || e.code === 'invalid_value_range') {
      return res.status(400).json({ error: e.code })
    }
    throw e
  }

  res.json({ ok: true, saved: answers.length })
})

app.post('/api/q1/complete', (req, res) => {
  const demographicSchema = z.object({
    gender: z.string().max(24).optional().nullable(),
    age: z.number().int().min(16).max(80).optional().nullable(),
    grade: z.string().max(24).optional().nullable(),
    major: z.string().max(80).optional().nullable(),
    income: z.string().max(24).optional().nullable(),
    only_child: z.string().max(12).optional().nullable(),
    student_cadre: z.string().max(12).optional().nullable(),
    scholarship: z.string().max(12).optional().nullable(),
  })
  const schema = z.object({
    questionnaireSessionId: z.string().min(6).max(32),
    participantId: z.string().min(1).max(64),
    demographics: demographicSchema.optional(),
  })
  const parsed = schema.safeParse(req.body || {})
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { questionnaireSessionId, participantId } = parsed.data
  const session = db
    .prepare(
      `select questionnaire_session_id, participant_id, started_at, completed_at from questionnaire_sessions where questionnaire_session_id = ?`
    )
    .get(questionnaireSessionId)
  if (!session) return res.status(404).json({ error: 'questionnaire_session_not_found' })
  if (session.participant_id !== participantId) return res.status(403).json({ error: 'participant_mismatch' })
  if (session.completed_at) return res.status(409).json({ error: 'questionnaire_already_completed' })

  const answerRows = db
    .prepare(
      `select item_id, answer_value from questionnaire_answers where questionnaire_session_id = ?`
    )
    .all(questionnaireSessionId)
  const answersByItem = new Map(answerRows.map((r) => [r.item_id, r.answer_value]))
  const scores = scoreQuestionnaire(answersByItem)
  const missingCount = Math.max(0, Q1_REQUIRED_ITEM_COUNT - answerRows.length)
  const attentionChecks = questionnaireSchema.attentionChecks || []
  const attentionTotal = attentionChecks.length
  const attentionCorrect = attentionChecks.filter((c) => answersByItem.get(c.itemId) === c.expectedValue).length
  const attentionPassed = attentionTotal > 0 ? (attentionCorrect === attentionTotal ? 1 : 0) : 1
  const socialChecks = questionnaireSchema.softChecks?.socialDesirability || []
  const socialFlag =
    socialChecks.some((c) => Number(answersByItem.get(c.itemId) ?? 0) >= Number(c.highThreshold ?? 999)) ? 1 : 0
  const contradictoryPairs = questionnaireSchema.softChecks?.contradictoryPairs || []
  const conflictFlag = contradictoryPairs.some((c) => {
    const a = Number(answersByItem.get(c.positiveItemId) ?? 0)
    const b = Number(answersByItem.get(c.negativeItemId) ?? 0)
    const t = Number(c.highThreshold ?? 999)
    return a >= t && b >= t
  })
    ? 1
    : 0
  const durationMs = Math.max(
    0,
    Math.round(Date.now() - new Date(session.started_at).getTime())
  )
  const quality = evaluateQuestionnaireQuality({
    attention_passed: attentionPassed,
    missing_count: missingCount,
    duration_ms: durationMs,
    soft_social_flag: socialFlag,
    soft_conflict_flag: conflictFlag,
  })

  db.transaction(() => {
    db.prepare(
      `update questionnaire_sessions set
        completed_at = ?,
        duration_ms = ?,
        missing_count = ?,
        prds = ?,
        pmd = ?,
        aq = ?,
        aq_physical = ?,
        aq_verbal = ?,
        aq_anger = ?,
        aq_hostility = ?,
        erq_cr = ?,
        answer_count = ?,
        attention_correct = ?,
        attention_total = ?,
        attention_passed = ?,
        soft_social_flag = ?,
        soft_conflict_flag = ?,
        response_quality_level = ?,
        exclude_recommended = ?
      where questionnaire_session_id = ?`
    ).run(
      nowIso(),
      durationMs,
      missingCount,
      scores.PRDS ?? null,
      scores.PMD ?? null,
      scores.AQ ?? null,
      scores.AQ_physical ?? null,
      scores.AQ_verbal ?? null,
      scores.AQ_anger ?? null,
      scores.AQ_hostility ?? null,
      scores.ERQ_CR ?? null,
      answerRows.length,
      attentionCorrect,
      attentionTotal,
      attentionPassed,
      socialFlag,
      conflictFlag,
      quality.response_quality_level,
      quality.exclude_recommended,
      questionnaireSessionId
    )

    if (parsed.data.demographics) {
      const d = parsed.data.demographics
      db.prepare(
        `insert into participant_demographics
        (participant_id, gender, age, grade, major, income, only_child, student_cadre, scholarship, updated_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(participant_id) do update set
          gender = excluded.gender,
          age = excluded.age,
          grade = excluded.grade,
          major = excluded.major,
          income = excluded.income,
          only_child = excluded.only_child,
          student_cadre = excluded.student_cadre,
          scholarship = excluded.scholarship,
          updated_at = excluded.updated_at`
      ).run(
        participantId,
        d.gender ?? null,
        d.age ?? null,
        d.grade ?? null,
        d.major ?? null,
        d.income ?? null,
        d.only_child ?? null,
        d.student_cadre ?? null,
        d.scholarship ?? null,
        nowIso()
      )
    }

    db.prepare(
      `insert into participant_scales_snapshot
      (participant_id, questionnaire_session_id, prds, pmd, aq, aq_physical, aq_verbal, aq_anger, aq_hostility, erq_cr, item_count, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(participant_id) do update set
        questionnaire_session_id = excluded.questionnaire_session_id,
        prds = excluded.prds,
        pmd = excluded.pmd,
        aq = excluded.aq,
        aq_physical = excluded.aq_physical,
        aq_verbal = excluded.aq_verbal,
        aq_anger = excluded.aq_anger,
        aq_hostility = excluded.aq_hostility,
        erq_cr = excluded.erq_cr,
        item_count = excluded.item_count,
        updated_at = excluded.updated_at`
    ).run(
      participantId,
      questionnaireSessionId,
      scores.PRDS ?? null,
      scores.PMD ?? null,
      scores.AQ ?? null,
      scores.AQ_physical ?? null,
      scores.AQ_verbal ?? null,
      scores.AQ_anger ?? null,
      scores.AQ_hostility ?? null,
      scores.ERQ_CR ?? null,
      answerRows.length,
      nowIso()
    )

    db.prepare(
      `insert into participants (participant_id, md, cr)
      values (?, ?, ?)
      on conflict(participant_id) do update set
        md = coalesce(excluded.md, participants.md),
        cr = coalesce(excluded.cr, participants.cr)`
    ).run(participantId, scores.PMD ?? null, scores.ERQ_CR ?? null)
  })()

  res.json({
    ok: true,
    questionnaireSessionId,
    missingCount,
    answerCount: answerRows.length,
    attention: {
      correct: attentionCorrect,
      total: attentionTotal,
      passed: Boolean(attentionPassed),
    },
    quality,
    scores: {
      prds: scores.PRDS ?? null,
      pmd: scores.PMD ?? null,
      aq: scores.AQ ?? null,
      aq_physical: scores.AQ_physical ?? null,
      aq_verbal: scores.AQ_verbal ?? null,
      aq_anger: scores.AQ_anger ?? null,
      aq_hostility: scores.AQ_hostility ?? null,
      erq_cr: scores.ERQ_CR ?? null,
    },
  })
})

app.get('/api/invite/:token', (req, res) => {
  const token = String(req.params.token || '').trim()
  if (token.length < 6 || token.length > 32) return res.status(400).json({ error: 'invalid_token' })

  const row = db.prepare(`select * from invites where token = ?`).get(token)
  const st = inviteSelectable(row)
  if (!st.ok) {
    const code = st.code === 'not_found' ? 404 : 410
    return res.status(code).json({ error: st.code })
  }

  res.json({
    ok: true,
    participantId: row.participant_id || null,
    locked: Boolean(row.participant_id),
    label: row.label || null,
  })
})

app.post('/api/admin/invites', (req, res) => {
  if (!requireExportToken(req, res)) return

  const schema = z.object({
    participantId: z.string().min(1).max(64).optional().nullable(),
    label: z.string().max(120).optional().nullable(),
    maxUses: z.number().int().min(1).max(100).optional(),
    expiresInDays: z.number().int().min(1).max(3650).optional().nullable(),
  })
  const parsed = schema.safeParse(req.body || {})
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  let { participantId, label, maxUses, expiresInDays } = parsed.data
  if (participantId != null && String(participantId).trim() === '') participantId = null
  const pid = participantId != null ? String(participantId).trim() : null

  let token = inviteNanoid()
  for (let i = 0; i < 5; i++) {
    const hit = db.prepare(`select 1 from invites where token = ?`).get(token)
    if (!hit) break
    token = inviteNanoid()
  }

  let expiresAt = null
  if (expiresInDays != null) {
    expiresAt = new Date(Date.now() + expiresInDays * 86400000).toISOString()
  }

  db.prepare(
    `insert into invites (token, participant_id, label, max_uses, use_count, expires_at)
     values (@token, @participant_id, @label, @max_uses, 0, @expires_at)`
  ).run({
    token,
    participant_id: pid,
    label: label != null ? String(label).trim() || null : null,
    max_uses: maxUses ?? 1,
    expires_at: expiresAt,
  })

  const path = `/?invite=${encodeURIComponent(token)}`
  const base = (process.env.PUBLIC_WEB_URL || '').replace(/\/$/, '')
  const fullUrl = base ? `${base}${path}` : null

  res.json({ ok: true, token, path, fullUrl })
})

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
      .card + .card { margin-top: 16px; }
      textarea.inviteOut {
        width: 100%;
        min-height: 88px;
        box-sizing: border-box;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 12px;
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid rgba(120,120,140,0.35);
        background: rgba(0,0,0,0.04);
      }
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
          <a id="downloadQ2" class="btn" href="#"><button type="button">下载研究二 CSV</button></a>
          <a id="downloadQ1" class="btn" href="#"><button type="button">下载研究一 CSV</button></a>
          <a id="downloadMerged" class="btn" href="#"><button type="button">下载合并 CSV</button></a>
          <button id="clear" type="button">清除本地口令</button>
        </div>
        <div id="err" class="err" style="display:none"></div>
        <p style="margin-top:12px" class="hint">研究二被试级导出：/api/export.csv?token=EXPORT_TOKEN</p>
        <p class="hint">研究一问卷导出：/api/export_research1.csv?token=EXPORT_TOKEN</p>
        <p class="hint">研究一+研究二合并导出：/api/export_merged.csv?token=EXPORT_TOKEN</p>
        <p class="hint">trial 级导出：/api/export_trials.csv?token=EXPORT_TOKEN</p>
      </div>
      <div class="card">
        <h1>生成被试邀请链接</h1>
        <p>将链接发给被试；对方在浏览器中打开并完成实验后，数据会自动写入数据库。导出 CSV 含 <span class="hint">invite_token</span> 列，便于核对招募来源。</p>
        <label>
          <div>前端公网地址（与发给被试打开的页面一致，不要以 / 结尾）</div>
          <input id="webBase" placeholder="例如：https://你的站点.pages.dev" />
        </label>
        <label>
          <div>被试 ID（可选）</div>
          <input id="invPid" placeholder="留空：由被试自行填写；填写：链接内锁定该 ID" />
        </label>
        <label>
          <div>备注（可选，仅用于后台记录）</div>
          <input id="invLabel" placeholder="例如：批次 A / 预实验" />
        </label>
        <div class="row">
          <label style="flex:1;min-width:160px">
            <div>可用次数（同一链接可开始几次实验）</div>
            <input id="maxUses" type="number" min="1" max="100" value="1" />
          </label>
          <label style="flex:1;min-width:160px">
            <div>有效天数（留空表示不过期）</div>
            <input id="expDays" type="number" min="1" max="3650" placeholder="留空" />
          </label>
        </div>
        <div class="row">
          <button id="mkInvite" type="button">生成邀请链接</button>
          <button id="copyInvite" type="button" disabled>复制完整链接</button>
        </div>
        <textarea id="inviteOut" class="inviteOut" style="display:none;margin-top:10px" readonly></textarea>
        <div id="inviteErr" class="err" style="display:none;margin-top:10px"></div>
        <p class="hint" style="margin-top:10px">若在后端设置环境变量 <span class="hint">PUBLIC_WEB_URL</span>，接口响应会直接包含完整 <span class="hint">fullUrl</span>。</p>
      </div>
    </div>
    <script>
      const key = 'crtt_export_token'
      const $token = document.getElementById('token')
      const $downloadQ2 = document.getElementById('downloadQ2')
      const $downloadQ1 = document.getElementById('downloadQ1')
      const $downloadMerged = document.getElementById('downloadMerged')
      const $err = document.getElementById('err')
      function setErr(msg) {
        if (!msg) { $err.style.display='none'; $err.textContent=''; return }
        $err.style.display='block'; $err.textContent = msg
      }
      function refresh() {
        const t = ($token.value || '').trim()
        $downloadQ2.href = '/api/export.csv?token=' + encodeURIComponent(t)
        $downloadQ1.href = '/api/export_research1.csv?token=' + encodeURIComponent(t)
        $downloadMerged.href = '/api/export_merged.csv?token=' + encodeURIComponent(t)
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
      function bindDownloadPreflight($node) {
        $node.addEventListener('click', async (e) => {
          setErr('')
          const url = $node.href
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
      }
      bindDownloadPreflight($downloadQ2)
      bindDownloadPreflight($downloadQ1)
      bindDownloadPreflight($downloadMerged)

      const webKey = 'crtt_public_web_url'
      const $webBase = document.getElementById('webBase')
      const $invPid = document.getElementById('invPid')
      const $invLabel = document.getElementById('invLabel')
      const $maxUses = document.getElementById('maxUses')
      const $expDays = document.getElementById('expDays')
      const $inviteOut = document.getElementById('inviteOut')
      const $inviteErr = document.getElementById('inviteErr')
      const $copyInvite = document.getElementById('copyInvite')
      $webBase.value = (localStorage.getItem(webKey) || '')
      let lastInviteUrl = ''
      function setInviteErr(msg) {
        if (!msg) { $inviteErr.style.display='none'; $inviteErr.textContent=''; return }
        $inviteErr.style.display='block'; $inviteErr.textContent = msg
      }
      document.getElementById('mkInvite').addEventListener('click', async () => {
        setInviteErr('')
        const exportToken = ($token.value || '').trim()
        if (!exportToken) { setInviteErr('请先填写 EXPORT_TOKEN'); return }
        localStorage.setItem(webKey, ($webBase.value || '').trim())
        let expiresInDays = null
        const ed = String($expDays.value || '').trim()
        if (ed !== '') {
          const n = Number(ed)
          if (!Number.isFinite(n) || n < 1) { setInviteErr('有效天数必须是正整数'); return }
          expiresInDays = Math.min(3650, Math.floor(n))
        }
        const maxUses = Math.min(100, Math.max(1, Math.floor(Number($maxUses.value) || 1)))
        try {
          const r = await fetch('/api/admin/invites', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              exportToken,
              participantId: ($invPid.value || '').trim() || null,
              label: ($invLabel.value || '').trim() || null,
              maxUses,
              expiresInDays,
            }),
          })
          const data = await r.json().catch(() => ({}))
          if (!r.ok) {
            setInviteErr('生成失败（HTTP ' + r.status + '）。请确认 EXPORT_TOKEN 正确。')
            return
          }
          const base = ($webBase.value || '').trim().replace(/\\/+$/, '')
          lastInviteUrl = data.fullUrl || (base ? base + data.path : '')
          const lines = lastInviteUrl
            ? (lastInviteUrl + '\\n\\n相对路径：' + data.path)
            : ('请填写「前端公网地址」后复制；相对路径：' + data.path)
          $inviteOut.style.display = 'block'
          $inviteOut.value = lines
          $copyInvite.disabled = !lastInviteUrl
        } catch (err) {
          setInviteErr('生成失败：网络错误')
        }
      })
      $copyInvite.addEventListener('click', async () => {
        if (!lastInviteUrl) return
        try {
          await navigator.clipboard.writeText(lastInviteUrl)
        } catch (e) {
          setInviteErr('复制失败：请手动全选文本框内容复制')
        }
      })
    </script>
  </body>
</html>`)
})

app.post('/api/session/start', (req, res) => {
  const schema = z.object({
    participantId: z.string().min(1).max(64),
    md: z.number().finite().optional(),
    cr: z.number().finite().optional(),
    userAgent: z.string().max(512).optional(),
    inviteToken: z.string().min(6).max(32).optional(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { participantId, md, cr, userAgent, inviteToken } = parsed.data
  const sessionId = nanoid()

  const upsertParticipant = db.prepare(`
    insert into participants (participant_id, md, cr)
    values (@participant_id, @md, @cr)
    on conflict(participant_id) do update set
      md = coalesce(excluded.md, participants.md),
      cr = coalesce(excluded.cr, participants.cr)
  `)
  const insertSession = db.prepare(
    `insert into sessions (session_id, participant_id, user_agent, invite_token)
     values (?, ?, ?, ?)`
  )
  const bumpInvite = db.prepare(`
    update invites set use_count = use_count + 1
    where token = ? and use_count < max_uses
  `)

  try {
    db.transaction(() => {
      if (inviteToken) {
        const inv = db.prepare(`select * from invites where token = ?`).get(inviteToken)
        const st = inviteSelectable(inv)
        if (!st.ok) {
          const err = new Error(st.code)
          err.code = st.code
          throw err
        }
        if (inv.participant_id && inv.participant_id !== participantId) {
          const err = new Error('participant_mismatch')
          err.code = 'participant_mismatch'
          throw err
        }
        const u = bumpInvite.run(inviteToken)
        if (u.changes !== 1) {
          const err = new Error('invite_exhausted')
          err.code = 'invite_exhausted'
          throw err
        }
      }

      upsertParticipant.run({ participant_id: participantId, md: md ?? null, cr: cr ?? null })
      insertSession.run(sessionId, participantId, userAgent ?? null, inviteToken ?? null)
    })()
  } catch (e) {
    const code = e && e.code
    if (code === 'not_found') return res.status(404).json({ error: 'invite_not_found' })
    if (code === 'expired') return res.status(410).json({ error: 'invite_expired' })
    if (code === 'exhausted' || code === 'invite_exhausted') {
      return res.status(410).json({ error: 'invite_exhausted' })
    }
    if (code === 'participant_mismatch') return res.status(403).json({ error: 'participant_mismatch' })
    throw e
  }

  const plan = generateCrttPlan({ trials: CRTT_TOTAL_TRIALS })
  res.json({ sessionId, plan })
})

app.post('/api/participant/scales', (req, res) => {
  const schema = z.object({
    participantId: z.string().min(1).max(64),
    md: z.number().finite().nullable().optional(),
    cr: z.number().finite().nullable().optional(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { participantId, md, cr } = parsed.data
  const upsertParticipant = db.prepare(`
    insert into participants (participant_id, md, cr)
    values (@participant_id, @md, @cr)
    on conflict(participant_id) do update set
      md = coalesce(excluded.md, participants.md),
      cr = coalesce(excluded.cr, participants.cr)
  `)
  upsertParticipant.run({
    participant_id: participantId,
    md: md ?? null,
    cr: cr ?? null,
  })

  const row = db
    .prepare(`select participant_id as participantId, md, cr from participants where participant_id = ?`)
    .get(participantId)
  res.json({ ok: true, participant: row })
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
    trialIndex: z.number().int().min(0).max(CRTT_TOTAL_TRIALS - 1),
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
  const score = (t) => t.participant_intensity * (t.participant_duration_ms / 1000)
  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + score(b), 0) / arr.length : null)

  const dv1Trials = trials.filter((t) => t.trial_index >= 0 && t.trial_index < CRTT_BASELINE_TRIALS)
  const dv2Trials = trials.filter((t) => t.trial_index >= CRTT_BASELINE_TRIALS)

  return {
    dv1_trial_start: 1,
    dv1_trial_end: CRTT_BASELINE_TRIALS,
    dv1_n: dv1Trials.length,
    dv1_unprovoked: mean(dv1Trials),
    dv2_trial_start: CRTT_BASELINE_TRIALS + 1,
    dv2_trial_end: CRTT_TOTAL_TRIALS,
    dv2_n: dv2Trials.length,
    dv2_provoked: mean(dv2Trials),
  }
}

app.get('/api/export_research1.csv', (req, res) => {
  const token = req.query.token
  if (!process.env.EXPORT_TOKEN || token !== process.env.EXPORT_TOKEN) {
    return res.status(401).send('unauthorized')
  }

  const rows = db
    .prepare(
      `select
        qs.questionnaire_session_id,
        qs.participant_id,
        qs.schema_version,
        qs.started_at,
        qs.completed_at,
        qs.duration_ms,
        qs.answer_count,
        qs.missing_count,
        qs.attention_correct,
        qs.attention_total,
        qs.attention_passed,
        qs.soft_social_flag,
        qs.soft_conflict_flag,
        qs.response_quality_level,
        qs.exclude_recommended,
        qs.completed_once,
        qs.prds,
        qs.pmd,
        qs.aq,
        qs.aq_physical,
        qs.aq_verbal,
        qs.aq_anger,
        qs.aq_hostility,
        qs.erq_cr,
        d.gender,
        d.age,
        d.grade,
        d.major,
        d.income,
        d.only_child,
        d.student_cadre,
        d.scholarship
      from questionnaire_sessions qs
      left join participant_demographics d on d.participant_id = qs.participant_id
      where qs.completed_at is not null
      order by qs.started_at asc`
    )
    .all()
    .map((r) => ({ ...r, ...evaluateQuestionnaireQuality(r) }))

  const csv = stringify(rows, { header: true })
  res.setHeader('content-type', 'text/csv; charset=utf-8')
  res.send(csv)
})

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
      invite_token: s.invite_token ?? null,
      started_at: s.started_at,
      completed_at: s.completed_at,
      anger_rating: s.anger_rating,
      md: s.md,
      cr: s.cr,
      dv1_trial_start: dv.dv1_trial_start,
      dv1_trial_end: dv.dv1_trial_end,
      dv1_n: dv.dv1_n,
      dv1_unprovoked: dv.dv1_unprovoked,
      dv2_trial_start: dv.dv2_trial_start,
      dv2_trial_end: dv.dv2_trial_end,
      dv2_n: dv.dv2_n,
      dv2_provoked: dv.dv2_provoked,
      trials_json: JSON.stringify(trials),
    })
  }

  const csv = stringify(rows, { header: true })
  res.setHeader('content-type', 'text/csv; charset=utf-8')
  res.send(csv)
})

app.get('/api/export_merged.csv', (req, res) => {
  const token = req.query.token
  if (!process.env.EXPORT_TOKEN || token !== process.env.EXPORT_TOKEN) {
    return res.status(401).send('unauthorized')
  }

  const rows = db
    .prepare(
      `select
        qs.participant_id,
        qs.questionnaire_session_id,
        qs.completed_at as q1_completed_at,
        qs.prds,
        qs.pmd,
        qs.aq,
        qs.aq_physical,
        qs.aq_verbal,
        qs.aq_anger,
        qs.aq_hostility,
        qs.erq_cr,
        qs.duration_ms as q1_duration_ms,
        qs.missing_count as q1_missing_count,
        qs.answer_count as q1_answer_count,
        qs.attention_correct as q1_attention_correct,
        qs.attention_total as q1_attention_total,
        qs.attention_passed as q1_attention_passed,
        qs.soft_social_flag as q1_soft_social_flag,
        qs.soft_conflict_flag as q1_soft_conflict_flag,
        qs.response_quality_level as q1_response_quality_level,
        qs.exclude_recommended as q1_exclude_recommended,
        d.gender,
        d.age,
        d.grade,
        d.major,
        d.income,
        d.only_child,
        d.student_cadre,
        d.scholarship,
        s.session_id as q2_session_id,
        s.started_at as q2_started_at,
        s.completed_at as q2_completed_at,
        s.anger_rating,
        s.invite_token,
        p.md as md_for_q2,
        p.cr as cr_for_q2
      from questionnaire_sessions qs
      left join participant_demographics d on d.participant_id = qs.participant_id
      left join sessions s on s.participant_id = qs.participant_id
      left join participants p on p.participant_id = qs.participant_id
      where qs.completed_at is not null
      order by qs.started_at asc, s.started_at asc`
    )
    .all()
    .map((r) => ({
      ...r,
      ...evaluateQuestionnaireQuality({
        attention_passed: r.q1_attention_passed,
        missing_count: r.q1_missing_count,
        duration_ms: r.q1_duration_ms,
        soft_social_flag: r.q1_soft_social_flag,
        soft_conflict_flag: r.q1_soft_conflict_flag,
      }),
    }))

  const trialStmt = db.prepare(
    `select * from trials where session_id = ? order by trial_index asc`
  )
  const enriched = rows.map((r) => {
    if (!r.q2_session_id) {
      return {
        ...r,
        dv1_n: null,
        dv1_unprovoked: null,
        dv2_n: null,
        dv2_provoked: null,
      }
    }
    const dv = computeDv(trialStmt.all(r.q2_session_id))
    return {
      ...r,
      dv1_n: dv.dv1_n,
      dv1_unprovoked: dv.dv1_unprovoked,
      dv2_n: dv.dv2_n,
      dv2_provoked: dv.dv2_provoked,
    }
  })

  const csv = stringify(enriched, { header: true })
  res.setHeader('content-type', 'text/csv; charset=utf-8')
  res.send(csv)
})

app.get('/api/export_trials.csv', (req, res) => {
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
    for (const t of trials) {
      const participantPunishment = t.participant_intensity * (t.participant_duration_ms / 1000)
      rows.push({
        participant_id: s.participant_id,
        session_id: s.session_id,
        invite_token: s.invite_token ?? null,
        started_at: s.started_at,
        completed_at: s.completed_at,
        anger_rating: s.anger_rating,
        md: s.md,
        cr: s.cr,
        trial_index: t.trial_index,
        outcome: t.outcome,
        participant_rt_ms: t.participant_rt_ms,
        participant_intensity: t.participant_intensity,
        participant_duration_ms: t.participant_duration_ms,
        participant_punishment: participantPunishment,
        opponent_intensity: t.opponent_intensity,
        opponent_duration_ms: t.opponent_duration_ms,
        trial_number: t.trial_index + 1,
        is_baseline_phase: t.trial_index < CRTT_BASELINE_TRIALS ? 1 : 0,
        is_provocation_phase: t.trial_index >= CRTT_BASELINE_TRIALS ? 1 : 0,
        trial_recorded_at: t.created_at,
      })
    }
  }

  const csv = stringify(rows, { header: true })
  res.setHeader('content-type', 'text/csv; charset=utf-8')
  res.send(csv)
})

const WEB_DIST = path.join(__dirname, '..', 'web', 'dist')
if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST, { index: false }))
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (req.path.startsWith('/api')) {
      return res.status(404).type('json').send({ error: 'api_not_found', path: req.path })
    }
    res.sendFile(path.join(WEB_DIST, 'index.html'), (err) => {
      if (err) next(err)
    })
  })
}

const PORT = Number(process.env.PORT || 3001)
app.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`CRTT server listening on port ${PORT}`)
})

