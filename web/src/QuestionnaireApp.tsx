import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { apiFetch } from './api'

type Option = { value: number | string; label: string }
type DemographicField = {
  key: string
  label: string
  type: 'single' | 'number' | 'text'
  required?: boolean
  options?: Option[]
  min?: number
  max?: number
  maxLength?: number
}
type ScaleItem = { id: string; text: string; options: Option[] }
type Scale = {
  id: string
  title: string
  description?: string
  min: number
  max: number
  items: ScaleItem[]
}
type QuestionnaireSchema = {
  version: string
  title: string
  intro?: string
  demographics: DemographicField[]
  scales: Scale[]
}

type PersistedScaleLayout = { scaleId: string; itemIds: string[] }
type QuestionnaireDraft = {
  schemaVersion?: string
  participantId?: string
  consented?: boolean
  answers?: Record<string, number>
  demographics?: Record<string, string | number>
  scaleLayout?: PersistedScaleLayout[]
}

const QUESTIONNAIRE_DRAFT_KEY = 'research1-questionnaire-draft'

function readDraft(): QuestionnaireDraft | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(QUESTIONNAIRE_DRAFT_KEY)
    return raw ? (JSON.parse(raw) as QuestionnaireDraft) : null
  } catch {
    return null
  }
}

function buildRandomizedScales(schema: QuestionnaireSchema): Scale[] {
  const base = schema.scales
    .filter((s) => s.id !== 'ATTN')
    .map((s) => ({ ...s, items: [...s.items] }))
  const attentionItems = schema.scales.find((s) => s.id === 'ATTN')?.items ?? []
  if (!base.length || !attentionItems.length) return base

  for (const item of attentionItems) {
    const groupIdx = Math.floor(Math.random() * base.length)
    const target = base[groupIdx]
    const minPos = Math.min(1, target.items.length)
    const pos = minPos + Math.floor(Math.random() * Math.max(1, target.items.length - minPos + 1))
    target.items.splice(Math.min(pos, target.items.length), 0, item)
  }
  return base
}

function restoreScaleLayout(
  schema: QuestionnaireSchema,
  savedLayout: PersistedScaleLayout[] | undefined
): Scale[] | null {
  if (!savedLayout?.length) return null
  const baseScales = schema.scales.filter((s) => s.id !== 'ATTN')
  const itemMap = new Map(
    schema.scales.flatMap((scale) => scale.items.map((item) => [item.id, item] as const))
  )
  const expectedIds = new Set(Array.from(itemMap.keys()))
  const restored = savedLayout.map((saved) => {
    const meta = baseScales.find((scale) => scale.id === saved.scaleId)
    if (!meta) return null
    const items = saved.itemIds.map((id) => itemMap.get(id)).filter(Boolean) as ScaleItem[]
    if (items.length !== saved.itemIds.length) return null
    return { ...meta, items }
  })
  if (restored.some((scale) => scale == null)) return null

  const seen = new Set<string>()
  for (const scale of restored as Scale[]) {
    for (const item of scale.items) {
      if (seen.has(item.id)) return null
      seen.add(item.id)
    }
  }
  if (seen.size !== expectedIds.size) return null
  return restored as Scale[]
}

function readPidFromUrl(): string {
  const url = new URL(window.location.href)
  return (
    url.searchParams.get('pid') ||
    url.searchParams.get('participant_id') ||
    url.searchParams.get('rid') ||
    url.searchParams.get('response_id') ||
    ''
  )
}

function QuestionnaireApp() {
  const [schema, setSchema] = useState<QuestionnaireSchema | null>(null)
  const [participantId, setParticipantId] = useState(() => readDraft()?.participantId ?? readPidFromUrl())
  const [consented, setConsented] = useState(() => readDraft()?.consented ?? false)
  const [answers, setAnswers] = useState<Record<string, number>>(() => readDraft()?.answers ?? {})
  const [demographics, setDemographics] = useState<Record<string, string | number>>(
    () => readDraft()?.demographics ?? {}
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [displayScales, setDisplayScales] = useState<Scale[]>([])
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const mainRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    document.title = '研究一 · 问卷调查'
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await apiFetch('/api/q1/schema')
        if (!r.ok) throw new Error(`schema_failed_${r.status}`)
        const data = (await r.json()) as { ok?: boolean; schema?: QuestionnaireSchema }
        if (!cancelled) setSchema(data.schema ?? null)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'schema_failed')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const totalItems = useMemo(
    () => (schema ? schema.scales.reduce((acc, s) => acc + s.items.length, 0) : 0),
    [schema]
  )
  const answeredItems = useMemo(() => Object.keys(answers).length, [answers])

  useEffect(() => {
    if (!schema) return
    const draft = readDraft()
    const restored = restoreScaleLayout(schema, draft?.scaleLayout)
    setDisplayScales(restored ?? buildRandomizedScales(schema))
  }, [schema])

  useEffect(() => {
    if (!schema || !displayScales.length || submitted) return
    const draft: QuestionnaireDraft = {
      schemaVersion: schema.version,
      participantId,
      consented,
      answers,
      demographics,
      scaleLayout: displayScales.map((scale) => ({
        scaleId: scale.id,
        itemIds: scale.items.map((item) => item.id),
      })),
    }
    window.localStorage.setItem(QUESTIONNAIRE_DRAFT_KEY, JSON.stringify(draft))
  }, [schema, displayScales, participantId, consented, answers, demographics, submitted])

  const missingRequiredDemographics = useMemo(() => {
    if (!schema) return 0
    return schema.demographics.filter((f) => {
      if (!f.required) return false
      const v = demographics[f.key]
      return v == null || String(v).trim() === ''
    }).length
  }, [schema, demographics])

  const missingDemographicKeys = useMemo(() => {
    if (!schema) return new Set<string>()
    return new Set(
      schema.demographics
        .filter((f) => f.required)
        .filter((f) => {
          const v = demographics[f.key]
          return v == null || String(v).trim() === ''
        })
        .map((f) => f.key)
    )
  }, [schema, demographics])

  const missingAnswerIds = useMemo(() => {
    if (!displayScales.length) return new Set<string>()
    return new Set(
      displayScales.flatMap((scale) =>
        scale.items
          .filter((item) => answers[item.id] == null || String(answers[item.id]).trim() === '')
          .map((item) => item.id)
      )
    )
  }, [displayScales, answers])

  const incompleteHint = useMemo(() => {
    if (!submitAttempted || !schema) return null
    const parts: string[] = []
    if (participantId.trim().length < 1) parts.push('被试编号未填')
    if (missingDemographicKeys.size > 0) parts.push(`基本信息缺 ${missingDemographicKeys.size} 项`)
    if (missingAnswerIds.size > 0) parts.push(`题目未选 ${missingAnswerIds.size} 道`)
    if (!consented) parts.push('未勾选同意参加')
    if (!parts.length) return null
    return `无法提交：${parts.join('；')}。请补全下方红框内容后再点「提交问卷」。`
  }, [
    submitAttempted,
    schema,
    participantId,
    missingDemographicKeys.size,
    missingAnswerIds.size,
    consented,
  ])

  useEffect(() => {
    if (!submitAttempted || (!error && !incompleteHint)) return
    const id = window.requestAnimationFrame(() => {
      const root = mainRef.current ?? document
      const el = root.querySelector<HTMLElement>('.fieldErrorInput, .fieldErrorBox')
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    return () => window.cancelAnimationFrame(id)
  }, [submitAttempted, error, incompleteHint])

  async function submitAll() {
    if (!schema) return
    setSubmitAttempted(true)
    setBusy(true)
    setError(null)
    try {
      const trimmedPid = participantId.trim()
      if (!trimmedPid) throw new Error('participant_id_required')
      if (missingRequiredDemographics > 0) throw new Error('demographics_incomplete')
      if (answeredItems < totalItems) throw new Error('questionnaire_incomplete')
      if (!consented) throw new Error('consent_required')

      const startRes = await apiFetch('/api/q1/session/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ participantId: trimmedPid, userAgent: navigator.userAgent }),
      })
      if (!startRes.ok) throw new Error(`q1_start_failed_${startRes.status}`)
      const startData = (await startRes.json()) as { questionnaireSessionId: string }
      const questionnaireSessionId = startData.questionnaireSessionId

      const payloadAnswers = Object.entries(answers).map(([itemId, value]) => ({
        itemId,
        value: Number(value),
      }))

      const saveRes = await apiFetch('/api/q1/answers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questionnaireSessionId, participantId: trimmedPid, answers: payloadAnswers }),
      })
      if (!saveRes.ok) throw new Error(`q1_answers_failed_${saveRes.status}`)

      const completeRes = await apiFetch('/api/q1/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questionnaireSessionId, participantId: trimmedPid, demographics }),
      })
      if (!completeRes.ok) throw new Error(`q1_complete_failed_${completeRes.status}`)

      window.localStorage.removeItem(QUESTIONNAIRE_DRAFT_KEY)
      setSubmitted(true)
    } catch (e) {
      const code = e instanceof Error ? e.message : 'q1_submit_failed'
      const friendly =
        code === 'participant_id_required'
          ? '请先填写被试编号。'
          : code === 'demographics_incomplete'
            ? '你还有基本信息未填写，请补全所有红框项目。'
            : code === 'questionnaire_incomplete'
              ? '问卷仍有未作答题目，请完成所有红框题目后再提交。'
              : code === 'consent_required'
                ? '请先勾选“我已阅读说明并同意参加本研究”。'
                : code
      setError(friendly)
    } finally {
      setBusy(false)
    }
  }

  if (submitted) {
    return (
      <div className="page">
        <main className="card">
          <h1>调查问卷已提交</h1>
          <p className="muted">
            感谢你的参与。请保存你的被试编号；研究二（实验任务）需使用<strong>同一编号</strong>完成。
          </p>
        </main>
      </div>
    )
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">研究一 · 问卷调查</div>
        <div className="meta">
          <div className="pill">
            进度 {answeredItems}/{totalItems}
          </div>
        </div>
      </header>

      <main ref={mainRef} className="card">
        {incompleteHint || error ? (
          <div className="error">{incompleteHint ?? `出错了：${error}`}</div>
        ) : null}
        {!schema ? <p className="muted">正在加载问卷…</p> : null}

        {schema ? (
          <>
            <h1>{schema.title}</h1>
            <div className="muted notice" style={{ textAlign: 'left' }}>
              <p>
                亲爱的朋友，您好：
                <br />
                感谢您在百忙之中抽出宝贵的时间打开这份问卷。本部分为<strong>研究一（问卷）</strong>，通常先于<strong>研究二（实验任务）</strong>进行。这是一项关于“生活体验与人际互动模式”的心理学学术调研。
              </p>
              <p>
                在快节奏的现代生活中，我们每个人都会面临不同的境遇，也会有各自独特的情绪与应对方式。本次研究正是希望倾听您在日常生活中的真实感受，了解我们是如何感知周围环境，并在人际交往中表达自我的。您的每一份真实经历，对我们的研究都无比珍贵。
              </p>
              <p>
                在正式开始之前，想给您几点温馨的小提示：
                <br />
                • 遵从内心，没有对错：问卷中的所有问题都没有标准答案，也无好坏之分。请您完全卸下顾虑，不用去思考“怎么选才最好”，按照您在生活里最真实的感受和第一直觉作答即可。
                <br />
                • 绝对保密，安心作答：本次调研采用完全匿名的方式进行。您提供的所有信息仅供学术研究的整体数据分析使用，我们将对您的作答严格保密，绝对不会泄露您的任何个人隐私，请您放心畅所欲言。
              </p>
              <p>完成时长通常约 8-12 分钟，请在相对安静的环境下连续作答。</p>
              <p>若中途误退出，本设备同一浏览器下已填写内容会自动保留，重新打开页面后可继续作答。</p>
              {schema.intro ? <p>{schema.intro}</p> : null}
            </div>

            <label className="field">
              <div className="label">被试编号</div>
              <input
                className={submitAttempted && participantId.trim().length < 1 ? 'fieldErrorInput' : ''}
                value={participantId}
                onChange={(e) => setParticipantId(e.target.value)}
                placeholder="请与后续研究二实验任务使用同一编号"
                autoComplete="off"
              />
            </label>

            <h2>基本信息</h2>
            {schema.demographics.map((f) => (
              <label className="field" key={f.key}>
                <div className="label">
                  {f.label}
                  {f.required ? ' *' : ''}
                </div>
                {f.type === 'single' ? (
                  <select
                    className={`crttSelect ${
                      submitAttempted && missingDemographicKeys.has(f.key) ? 'fieldErrorInput' : ''
                    }`}
                    value={String(demographics[f.key] ?? '')}
                    onChange={(e) =>
                      setDemographics((prev) => ({ ...prev, [f.key]: e.target.value }))
                    }
                  >
                    <option value="">请选择</option>
                    {(f.options ?? []).map((opt) => (
                      <option key={String(opt.value)} value={String(opt.value)}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : f.type === 'number' ? (
                  <input
                    className={submitAttempted && missingDemographicKeys.has(f.key) ? 'fieldErrorInput' : ''}
                    type="number"
                    min={f.min}
                    max={f.max}
                    value={String(demographics[f.key] ?? '')}
                    onChange={(e) =>
                      setDemographics((prev) => ({
                        ...prev,
                        [f.key]: e.target.value === '' ? '' : Number(e.target.value),
                      }))
                    }
                  />
                ) : (
                  <input
                    className={submitAttempted && missingDemographicKeys.has(f.key) ? 'fieldErrorInput' : ''}
                    type="text"
                    maxLength={f.maxLength ?? 120}
                    value={String(demographics[f.key] ?? '')}
                    onChange={(e) =>
                      setDemographics((prev) => ({ ...prev, [f.key]: e.target.value }))
                    }
                  />
                )}
              </label>
            ))}

            {displayScales.map((scale, scaleIdx) => (
              <section key={scale.id}>
                <h2>体验题组 {scaleIdx + 1}</h2>
                <p className="muted">请根据你的真实情况选择最符合的一项。</p>
                {scale.items.map((item) => (
                  <label className="field" key={item.id}>
                    <div className="label">{item.text}</div>
                    <select
                      className={`crttSelect ${
                        submitAttempted && missingAnswerIds.has(item.id) ? 'fieldErrorInput' : ''
                      }`}
                      value={String(answers[item.id] ?? '')}
                      onChange={(e) =>
                        setAnswers((prev) => ({ ...prev, [item.id]: Number(e.target.value) }))
                      }
                    >
                      <option value="">请选择</option>
                      {item.options.map((opt) => (
                        <option key={String(opt.value)} value={String(opt.value)}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </section>
            ))}

            <label
              className={`checkbox ${submitAttempted && !consented ? 'fieldErrorBox' : ''}`}
            >
              <input
                type="checkbox"
                checked={consented}
                onChange={(e) => setConsented(e.target.checked)}
              />
              <span>我已阅读说明并同意参加本研究。</span>
            </label>

            <button
              className="primary"
              disabled={busy}
              onClick={() => void submitAll()}
            >
              {busy ? '提交中…' : '提交问卷'}
            </button>
            <p className="muted" style={{ marginTop: 10 }}>
              须完成全部题目与基本信息，并勾选同意后方能提交。若有缺项，点击提交后会标红并提示。
            </p>
          </>
        ) : null}
      </main>
    </div>
  )
}

export default QuestionnaireApp
