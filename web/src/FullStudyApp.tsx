import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import './App.css'
import './OnlinePointsApp.css'
import { apiFetch } from './api'

type FlowStage =
  | 'setup'
  | 'practice'
  | 'rules'
  | 'scenario'
  | 'rd'
  | 'm'
  | 'regulation'
  | 'task'
  | 'checks'
  | 'done'
type TaskPhase = 'choose' | 'drafting' | 'waiting' | 'go' | 'saving' | 'feedback' | 'reminder'

type Config = {
  studyVersion: string
  dataRole: 'test' | 'pilot' | 'formal'
  formalEnabled: boolean
  totalTrials: number
  initialTrials: number
  initialPoints: number
  rewardMode: string
  fullFlowTest: boolean
  candidateMeasures: boolean
}

type TrialRecord = {
  trial_index: number
  phase: 'initial' | 'mutual'
  planned_outcome: 'win' | 'loss'
  participant_deduction_choice: number
  participant_rt_ms: number | null
  deducted_from_participant: number
  deducted_from_opponent: number
  participant_points_after: number
  opponent_points_after: number
}

type PendingDraft = {
  trial_index: number
  participant_deduction_choice: number
  idempotency_key: string
  selected_at: string
}

type SessionState = {
  sessionId: string
  participantId: string
  studyVersion: string
  dataRole: 'test' | 'pilot' | 'formal'
  rewardMode: string
  flowStage: FlowStage
  conditionCode: string | null
  conditionX: 'freeride' | 'fair' | null
  conditionW: 'natural' | 'reappraisal' | null
  allocationBlock: number | null
  preflightPassed: boolean
  scenarioPassed: boolean
  completed: boolean
  nextTrialIndex: number
  totalTrials: number
  participantPoints: number
  opponentPoints: number
  regulationReminderSeen: boolean
  tabHiddenCount: number
  pendingDraft: PendingDraft | null
  trials: TrialRecord[]
}

type PreflightAnswer = {
  zeroMeaning: 'no_deduction' | 'deduct_one' | 'skip_trial'
  winnerTarget: 'self' | 'partner' | 'both'
  loserSource: 'own_choice' | 'partner_choice' | 'random'
  choiceAffectsWin: 'no' | 'yes' | 'only_high'
}

type ScenarioAnswer = {
  division: 'each_half' | 'self_only' | 'b_only'
  contribution: 'self_most' | 'both' | 'b_most'
  finalScore: 'both_90' | 'self_90' | 'b_90'
}

type PracticeRecord = {
  trialIndex: number
  choice: number
  outcome: 'win' | 'loss'
  deductedFromSelf: number
  deductedFromPracticeOpponent: number
}

type StoredSession = {
  sessionId: string
  participantId: string
  studyVersion: string
}

const ACTIVE_SESSION_STORAGE_KEY = 'research2_new_active_session'

const PRACTICE_PLAN = [
  { outcome: 'win' as const, opponentDeduction: 0 },
  { outcome: 'loss' as const, opponentDeduction: 2 },
  { outcome: 'win' as const, opponentDeduction: 0 },
]

const RD_ITEMS = [
  '和伙伴B相比，我觉得自己的付出没有得到应有的回报。',
  '我认为这样的结果对我不公平。',
  '想到这个结果，我感到不满。',
  '我觉得自己得到的回报少于自己应得的回报。',
]

const M_ITEMS = [
  {
    key: 'MD1',
    text: '想到刚才课程项目中的合作情况，如果我在接下来的游戏中选择扣除伙伴B较多积分，我觉得这种做法也是可以理解的。',
  },
  {
    key: 'MD2',
    text: '根据伙伴B在课程项目中的表现，如果B在接下来的游戏中损失一些积分，我觉得这是理所当然的。',
  },
  {
    key: 'MD3',
    text: '如果我在接下来的游戏中选择扣除伙伴B较多积分，我觉得这不只是我个人的原因，也和B在课程项目中的表现有关。',
  },
  {
    key: 'MD4',
    text: '比起伙伴B在课程项目中的做法，我在接下来的游戏中多扣B一些积分，也不过分。',
  },
]

function shuffle<T>(items: T[]) {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))
    const value = copy[index]
    copy[index] = copy[target]
    copy[target] = value
  }
  return copy
}

function readPidFromUrl() {
  const url = new URL(window.location.href)
  return (
    url.searchParams.get('pid') ||
    url.searchParams.get('participant_id') ||
    url.searchParams.get('rid') ||
    ''
  )
}

function makeIdempotencyKey(sessionId: string, trialIndex: number) {
  const randomPart = Math.random().toString(36).slice(2, 10)
  return sessionId + '-' + trialIndex + '-' + Date.now() + '-' + randomPart
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & { error?: unknown }
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : '请求失败，请稍后重试。'
    throw new Error(message)
  }
  return body
}

async function postJson<T>(path: string, body: unknown) {
  const response = await apiFetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return readJson<T>(response)
}

function roleLabel(role: SessionState['dataRole'] | Config['dataRole'] | undefined) {
  if (role === 'pilot') return '预测试'
  if (role === 'formal') return '正式实验'
  return '完整流程测试'
}

function readStoredSession(): StoredSession | null {
  try {
    const value = window.localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY)
    if (!value) return null
    const parsed = JSON.parse(value) as Partial<StoredSession>
    if (!parsed.sessionId || !parsed.participantId || !parsed.studyVersion) return null
    return parsed as StoredSession
  } catch {
    return null
  }
}

function persistSession(state: SessionState) {
  try {
    if (state.completed) {
      window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY)
      return
    }
    window.localStorage.setItem(
      ACTIVE_SESSION_STORAGE_KEY,
      JSON.stringify({
        sessionId: state.sessionId,
        participantId: state.participantId,
        studyVersion: state.studyVersion,
      } satisfies StoredSession)
    )
  } catch {
    // Server-side participant/version lookup remains the recovery fallback.
  }
}

function FullStudyApp() {
  const [config, setConfig] = useState<Config | null>(null)
  const [step, setStep] = useState<'login' | FlowStage>('login')
  const [participantId, setParticipantId] = useState(readPidFromUrl)
  const [consented, setConsented] = useState(false)
  const [session, setSession] = useState<SessionState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [setup, setSetup] = useState({
    age18Plus: false,
    independentEnvironment: false,
    stableNetwork: false,
    pageReadable: false,
    priorSimilarStudy: false,
  })

  const [practiceIndex, setPracticeIndex] = useState(0)
  const [practiceChoice, setPracticeChoice] = useState<number | null>(null)
  const [practiceRecords, setPracticeRecords] = useState<PracticeRecord[]>([])
  const [practiceFeedback, setPracticeFeedback] = useState<PracticeRecord | null>(null)
  const [practiceSelfPoints, setPracticeSelfPoints] = useState(30)
  const [practiceOpponentPoints, setPracticeOpponentPoints] = useState(30)

  const [zeroMeaning, setZeroMeaning] = useState<PreflightAnswer['zeroMeaning'] | ''>('')
  const [winnerTarget, setWinnerTarget] = useState<PreflightAnswer['winnerTarget'] | ''>('')
  const [loserSource, setLoserSource] = useState<PreflightAnswer['loserSource'] | ''>('')
  const [choiceAffectsWin, setChoiceAffectsWin] = useState<PreflightAnswer['choiceAffectsWin'] | ''>('')
  const [preflightHistory, setPreflightHistory] = useState<PreflightAnswer[]>([])
  const [preflightMessage, setPreflightMessage] = useState<string | null>(null)

  const [scenarioDivision, setScenarioDivision] = useState<ScenarioAnswer['division'] | ''>('')
  const [scenarioContribution, setScenarioContribution] = useState<ScenarioAnswer['contribution'] | ''>('')
  const [scenarioFinalScore, setScenarioFinalScore] = useState<ScenarioAnswer['finalScore'] | ''>('')
  const [scenarioHistory, setScenarioHistory] = useState<ScenarioAnswer[]>([])
  const [scenarioMessage, setScenarioMessage] = useState<string | null>(null)

  const [rdAnswers, setRdAnswers] = useState<Array<number | null>>([null, null, null, null])
  const [mOrder] = useState(() => shuffle(M_ITEMS))
  const [mAnswers, setMAnswers] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(M_ITEMS.map((item) => [item.key, null]))
  )
  const [choice, setChoice] = useState<number | null>(null)
  const [taskPhase, setTaskPhase] = useState<TaskPhase>('choose')
  const [feedbackTrial, setFeedbackTrial] = useState<TrialRecord | null>(null)
  const goAtRef = useRef<number | null>(null)
  const timerRef = useRef<number | null>(null)
  const pendingKeyRef = useRef<string | null>(null)
  const visibilityCountRef = useRef(0)
  const stepEnteredAtRef = useRef(Date.now())

  const [regulationCheck, setRegulationCheck] = useState<Array<number | null>>([null, null, null])
  const [feedbackResponsiveness, setFeedbackResponsiveness] = useState<number | null>(null)
  const [believedChoiceAffectedOpponent, setBelievedChoiceAffectedOpponent] = useState<number | null>(null)
  const [rewardConsequenceImportance, setRewardConsequenceImportance] = useState<number | null>(null)
  const [seriousCompletion, setSeriousCompletion] = useState<number | null>(null)
  const [interruptionLevel, setInterruptionLevel] = useState<number | null>(null)
  const [motiveRetaliation, setMotiveRetaliation] = useState<number | null>(null)
  const [motiveHarm, setMotiveHarm] = useState<number | null>(null)
  const [motiveWinBelief, setMotiveWinBelief] = useState<number | null>(null)
  const [motiveConvenience, setMotiveConvenience] = useState<number | null>(null)
  const [motiveScoreGap, setMotiveScoreGap] = useState<number | null>(null)

  useEffect(() => {
    let active = true
    void apiFetch('/api/online-points/config')
      .then((response) => readJson<{ ok: boolean } & Config>(response))
      .then((body) => {
        if (active) setConfig(body)
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : '无法读取实验配置。')
      })
    return () => {
      active = false
      if (timerRef.current != null) window.clearTimeout(timerRef.current)
    }
  }, [])

  const activeSessionId = session?.sessionId
  const sessionCompleted = session?.completed
  const serverTabHiddenCount = session?.tabHiddenCount ?? 0

  useEffect(() => {
    if (!activeSessionId || sessionCompleted) return
    visibilityCountRef.current = Math.max(visibilityCountRef.current, serverTabHiddenCount)
    const recordVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return
      visibilityCountRef.current += 1
      void postJson<{ ok: boolean; state: SessionState }>('/api/online-points/session/visibility', {
        sessionId: activeSessionId,
        tabHiddenCount: visibilityCountRef.current,
      }).catch(() => {
        // The next hidden event or session resume retries with the accumulated count.
      })
    }
    document.addEventListener('visibilitychange', recordVisibilityChange)
    return () => document.removeEventListener('visibilitychange', recordVisibilityChange)
  }, [activeSessionId, sessionCompleted, serverTabHiddenCount])

  const routeFromSession = useCallback((state: SessionState) => {
    setSession(state)
    persistSession(state)
    visibilityCountRef.current = Math.max(visibilityCountRef.current, state.tabHiddenCount || 0)
    setStep(state.flowStage)
    if (state.flowStage === 'task') {
      setFeedbackTrial(null)
      setTaskPhase(
        state.nextTrialIndex >= (config?.initialTrials ?? 7) && !state.regulationReminderSeen
          ? 'reminder'
          : 'choose'
      )
      if (state.pendingDraft && state.pendingDraft.trial_index === state.nextTrialIndex) {
        setChoice(state.pendingDraft.participant_deduction_choice)
        pendingKeyRef.current = state.pendingDraft.idempotency_key
      } else {
        setChoice(null)
        pendingKeyRef.current = null
      }
    }
  }, [config?.initialTrials])

  useEffect(() => {
    if (!config) return
    const stored = readStoredSession()
    if (!stored) return
    if (stored.studyVersion !== config.studyVersion) {
      window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY)
      return
    }
    let active = true
    void apiFetch('/api/online-points/session/' + encodeURIComponent(stored.sessionId))
      .then((response) => readJson<{ ok: boolean; state: SessionState }>(response))
      .then((body) => {
        if (!active) return
        if (
          body.state.studyVersion !== stored.studyVersion ||
          body.state.participantId !== stored.participantId
        ) {
          window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY)
          return
        }
        setParticipantId(body.state.participantId)
        routeFromSession(body.state)
      })
      .catch(() => {
        window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY)
      })
    return () => {
      active = false
    }
  }, [config, routeFromSession])

  useEffect(() => {
    stepEnteredAtRef.current = Date.now()
  }, [step])

  function currentStepDurationMs() {
    return Math.min(3600000, Math.max(0, Date.now() - stepEnteredAtRef.current))
  }

  async function runAction(action: () => Promise<{ state: SessionState }>) {
    setBusy(true)
    setError(null)
    try {
      const body = await action()
      routeFromSession(body.state)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '提交失败，请重试。')
    } finally {
      setBusy(false)
    }
  }

  async function startSession() {
    const normalizedId = participantId.trim()
    if (!normalizedId || !consented) {
      setError('请填写测试编号，并确认知情同意。')
      return
    }
    await runAction(() =>
      postJson<{ ok: boolean; state: SessionState }>('/api/online-points/session/start', {
        participantId: normalizedId,
        userAgent: navigator.userAgent,
      })
    )
  }

  async function submitSetup() {
    if (
      !setup.age18Plus ||
      !setup.independentEnvironment ||
      !setup.stableNetwork ||
      !setup.pageReadable ||
      setup.priorSimilarStudy
    ) {
      setError('当前完整流程测试要求全部设备条件满足，且未接触过本实验事后说明。')
      return
    }
    if (!session) return
    await runAction(() =>
      postJson<{ ok: boolean; state: SessionState }>('/api/online-points/session/setup', {
        sessionId: session.sessionId,
        ...setup,
        device: {
          userAgent: navigator.userAgent,
          screenWidth: window.screen.width,
          screenHeight: window.screen.height,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          touchPoints: navigator.maxTouchPoints || 0,
          language: navigator.language || '',
        },
      })
    )
  }

  function settlePractice() {
    if (practiceChoice == null || practiceFeedback) return
    const plan = PRACTICE_PLAN[practiceIndex]
    const record: PracticeRecord = {
      trialIndex: practiceIndex,
      choice: practiceChoice,
      outcome: plan.outcome,
      deductedFromSelf: plan.outcome === 'loss' ? plan.opponentDeduction : 0,
      deductedFromPracticeOpponent: plan.outcome === 'win' ? practiceChoice : 0,
    }
    setPracticeRecords((current) => [...current, record])
    setPracticeSelfPoints((current) => current - record.deductedFromSelf)
    setPracticeOpponentPoints((current) => current - record.deductedFromPracticeOpponent)
    setPracticeFeedback(record)
  }

  async function continuePractice() {
    if (!practiceFeedback || !session) return
    if (practiceIndex < 2) {
      setPracticeIndex((current) => current + 1)
      setPracticeChoice(null)
      setPracticeFeedback(null)
      return
    }
    await runAction(() =>
      postJson<{ ok: boolean; state: SessionState }>('/api/online-points/session/practice', {
        sessionId: session.sessionId,
        trials: practiceRecords,
      })
    )
  }

  async function submitPreflight() {
    if (!session || !zeroMeaning || !winnerTarget || !loserSource || !choiceAffectsWin) {
      setPreflightMessage('请完成全部四道题。')
      return
    }
    if (preflightHistory.length >= 5) {
      setPreflightMessage('已达到规则检查次数上限，请停止测试并联系研究人员。')
      return
    }
    const answer: PreflightAnswer = { zeroMeaning, winnerTarget, loserSource, choiceAffectsWin }
    const history = [...preflightHistory, answer]
    setBusy(true)
    setError(null)
    try {
      const body = await postJson<{ ok: boolean; passed: boolean; state: SessionState }>(
        '/api/online-points/session/preflight',
        { sessionId: session.sessionId, comprehensionHistory: history }
      )
      setPreflightHistory(history)
      if (body.passed) {
        setPreflightMessage(null)
        routeFromSession(body.state)
      } else {
        setPreflightMessage('有答案不正确，请重新阅读规则后再答一次。')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '规则检查提交失败。')
    } finally {
      setBusy(false)
    }
  }

  async function submitScenario() {
    if (!session || !scenarioDivision || !scenarioContribution || !scenarioFinalScore) {
      setScenarioMessage('请完成全部三道情境理解题。')
      return
    }
    const answer: ScenarioAnswer = {
      division: scenarioDivision,
      contribution: scenarioContribution,
      finalScore: scenarioFinalScore,
    }
    const history = [...scenarioHistory, answer]
    setBusy(true)
    setError(null)
    try {
      const body = await postJson<{ ok: boolean; passed: boolean; state: SessionState }>(
        '/api/online-points/session/scenario',
        {
          sessionId: session.sessionId,
          answerHistory: history,
          durationMs: currentStepDurationMs(),
        }
      )
      setScenarioHistory(history)
      if (body.passed) {
        setScenarioMessage(null)
        routeFromSession(body.state)
      } else {
        setScenarioMessage('有答案与情境不一致，请重新阅读后再作答。')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '情境理解提交失败。')
    } finally {
      setBusy(false)
    }
  }

  async function submitRd() {
    if (!session || rdAnswers.some((answer) => answer == null)) {
      setError('请完成全部题目。')
      return
    }
    await runAction(() =>
      postJson<{ ok: boolean; state: SessionState }>('/api/online-points/session/rd', {
        sessionId: session.sessionId,
        answers: rdAnswers,
        durationMs: currentStepDurationMs(),
      })
    )
  }

  async function submitM() {
    if (!session || Object.values(mAnswers).some((answer) => answer == null)) {
      setError('请完成全部题目。')
      return
    }
    await runAction(() =>
      postJson<{ ok: boolean; state: SessionState }>(
        '/api/online-points/session/moral-disengagement',
        {
          sessionId: session.sessionId,
          answers: mAnswers,
          durationMs: currentStepDurationMs(),
        }
      )
    )
  }

  async function submitRegulation() {
    if (!session) return
    await runAction(() =>
      postJson<{ ok: boolean; state: SessionState }>('/api/online-points/session/regulation', {
        sessionId: session.sessionId,
        acknowledged: true,
        durationMs: currentStepDurationMs(),
      })
    )
  }

  async function beginTrial() {
    if (!session || choice == null || taskPhase !== 'choose') return
    setTaskPhase('drafting')
    setError(null)
    try {
      let activeSession = session
      let key = pendingKeyRef.current
      if (!activeSession.pendingDraft) {
        key = makeIdempotencyKey(session.sessionId, session.nextTrialIndex)
        const body = await postJson<{ ok: boolean; state: SessionState }>(
          '/api/online-points/trial/draft',
          {
            sessionId: session.sessionId,
            trialIndex: session.nextTrialIndex,
            participantDeductionChoice: choice,
            idempotencyKey: key,
          }
        )
        activeSession = body.state
        setSession(activeSession)
      } else {
        key = activeSession.pendingDraft.idempotency_key
      }
      pendingKeyRef.current = key
      setTaskPhase('waiting')
      const waitMs = 900 + Math.round(Math.random() * 1300)
      timerRef.current = window.setTimeout(() => {
        goAtRef.current = performance.now()
        setTaskPhase('go')
      }, waitMs)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '本轮选择暂存失败，请重试。')
      setTaskPhase('choose')
    }
  }

  async function respondGo() {
    if (!session || choice == null || taskPhase !== 'go' || goAtRef.current == null) return
    const rtMs = Math.max(50, Math.min(10000, Math.round(performance.now() - goAtRef.current)))
    const key =
      pendingKeyRef.current ||
      session.pendingDraft?.idempotency_key ||
      makeIdempotencyKey(session.sessionId, session.nextTrialIndex)
    setTaskPhase('saving')
    setError(null)
    try {
      const body = await postJson<{ ok: boolean; trial: TrialRecord; state: SessionState }>(
        '/api/online-points/trial/settle',
        {
          sessionId: session.sessionId,
          trialIndex: session.nextTrialIndex,
          participantDeductionChoice: choice,
          participantRtMs: rtMs,
          idempotencyKey: key,
        }
      )
      setSession(body.state)
      setFeedbackTrial(body.trial)
      setTaskPhase('feedback')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '本轮结算失败，请重试。')
      setTaskPhase('go')
    }
  }

  function prepareNextTrial() {
    setChoice(null)
    setFeedbackTrial(null)
    pendingKeyRef.current = null
    goAtRef.current = null
    setTaskPhase('choose')
  }

  function nextTrial() {
    if (!session || !feedbackTrial) return
    if (session.flowStage === 'checks' || session.nextTrialIndex >= session.totalTrials) {
      routeFromSession(session)
      return
    }
    if (feedbackTrial.trial_index === 6 && !session.regulationReminderSeen) {
      setTaskPhase('reminder')
      return
    }
    prepareNextTrial()
  }

  async function acknowledgeReminder() {
    if (!session) return
    setBusy(true)
    setError(null)
    try {
      const body = await postJson<{ ok: boolean; state: SessionState }>(
        '/api/online-points/session/regulation-reminder',
        { sessionId: session.sessionId }
      )
      setSession(body.state)
      prepareNextTrial()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '提醒确认失败，请重试。')
    } finally {
      setBusy(false)
    }
  }

  async function completeSession() {
    if (!session) return
    const required = [
      ...regulationCheck,
      feedbackResponsiveness,
      believedChoiceAffectedOpponent,
      rewardConsequenceImportance,
      seriousCompletion,
      interruptionLevel,
      motiveRetaliation,
      motiveHarm,
      motiveWinBelief,
      motiveConvenience,
      motiveScoreGap,
    ]
    if (required.some((value) => value == null)) {
      setError('请完成全部任务后问题。')
      return
    }
    await runAction(() =>
      postJson<{ ok: boolean; state: SessionState }>('/api/online-points/session/complete', {
        sessionId: session.sessionId,
        feedbackResponsiveness,
        believedChoiceAffectedOpponent,
        rewardConsequenceImportance,
        seriousCompletion,
        interruptionLevel,
        motiveRetaliation,
        motiveHarm,
        motiveWinBelief,
        motiveConvenience,
        motiveScoreGap,
        regulationCheck,
      })
    )
  }

  function restartInternalTest() {
    try {
      window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY)
    } finally {
      const url = new URL(window.location.href)
      url.searchParams.delete('pid')
      url.searchParams.delete('participant_id')
      url.searchParams.delete('rid')
      url.hash = ''
      window.location.replace(url.toString())
    }
  }

  const currentTrialNumber = (session?.nextTrialIndex ?? 0) + 1
  const taskProgress = session
    ? Math.round((session.nextTrialIndex / session.totalTrials) * 100)
    : 0
  const isInitial = (session?.nextTrialIndex ?? 0) < (config?.initialTrials ?? 7)

  return (
    <div className="page onlinePointsPage">
      <header className="topbar">
        <span className="brand">互动决策研究</span>
        <span className="onlineRoleBadge">{roleLabel(session?.dataRole || config?.dataRole)}</span>
      </header>

      <main className="card onlinePointsCard fullStudyCard">
        {error && <div className="error">{error}</div>}

        {session && !session.completed && session.dataRole === 'test' && (
          <div className="testSessionToolbar">
            <span>正在续作测试编号：{session.participantId}</span>
            <button type="button" className="secondary" onClick={restartInternalTest}>
              使用新编号重新测试
            </button>
          </div>
        )}

        {step === 'login' && (
          <section className="onlineIntro">
            <p className="onlineEyebrow">研究二 · 完整流程测试版</p>
            <h1>互动决策研究</h1>
            <p className="onlineLead">
              完整流程约需10分钟，包含情境阅读、简短问卷和15轮互动任务。请在安静环境中一次完成。
            </p>
            <div className="testOnlyBanner">
              当前版本只用于研究者内部测试。候选量表、奖励和伦理文本尚未正式冻结，不能用于正式招募。
            </div>
            <label className="field">
              <span className="label">测试编号</span>
              <input
                type="text"
                value={participantId}
                maxLength={64}
                autoComplete="off"
                onChange={(event) => setParticipantId(event.target.value)}
                placeholder="例如 FULLTEST-001"
              />
            </label>
            <label className="checkbox onlineConsent">
              <input
                type="checkbox"
                checked={consented}
                onChange={(event) => setConsented(event.target.checked)}
              />
              <span>我了解这是内部流程测试，可能包含竞争、不公平情境、积分损失和事后说明；我自愿参加。</span>
            </label>
            <button className="primary onlineWideButton" disabled={busy || !config} onClick={startSession}>
              {busy ? '正在进入…' : '开始完整测试'}
            </button>
          </section>
        )}

        {step === 'setup' && (
          <section>
            <p className="onlineEyebrow">步骤1 · 测试准备</p>
            <h2>请确认当前条件</h2>
            <div className="setupChecklist">
              <SetupCheck
                checked={setup.age18Plus}
                text="我已满18周岁"
                onChange={(checked) => setSetup({ ...setup, age18Plus: checked })}
              />
              <SetupCheck
                checked={setup.independentEnvironment}
                text="我能在安静环境中独立完成，不与他人讨论"
                onChange={(checked) => setSetup({ ...setup, independentEnvironment: checked })}
              />
              <SetupCheck
                checked={setup.stableNetwork}
                text="当前网络稳定，完成前不会主动关闭页面"
                onChange={(checked) => setSetup({ ...setup, stableNetwork: checked })}
              />
              <SetupCheck
                checked={setup.pageReadable}
                text="页面文字和按钮显示完整、大小合适"
                onChange={(checked) => setSetup({ ...setup, pageReadable: checked })}
              />
              <SetupCheck
                checked={!setup.priorSimilarStudy}
                text="我没有看过本实验的答案或事后说明"
                onChange={(checked) => setSetup({ ...setup, priorSimilarStudy: !checked })}
              />
            </div>
            <button className="primary onlineWideButton" disabled={busy} onClick={submitSetup}>
              {busy ? '正在保存…' : '进入练习'}
            </button>
          </section>
        )}

        {step === 'practice' && (
          <section>
            <p className="onlineEyebrow">步骤2 · 中性练习 {practiceIndex + 1}/3</p>
            <h2>积分规则练习</h2>
            <p className="muted onlineRuleNote">这是与正式任务分开的系统练习，不涉及后面出现的伙伴B，也不计入研究结果。</p>
            <div className="balanceGrid practiceBalances">
              <div><span>我的练习积分</span><strong>{practiceSelfPoints}</strong></div>
              <div><span>练习账户</span><strong>{practiceOpponentPoints}</strong></div>
            </div>
            {!practiceFeedback ? (
              <div className="choicePanel compactChoicePanel">
                <p className="choicePrompt">如果本轮获胜，你选择从练习账户扣除多少积分？</p>
                <PointGrid value={practiceChoice} onChange={setPracticeChoice} />
                <button className="primary onlineWideButton" disabled={practiceChoice == null} onClick={settlePractice}>
                  查看练习结果
                </button>
              </div>
            ) : (
              <div className={practiceFeedback.outcome === 'win' ? 'roundFeedback win compactFeedback' : 'roundFeedback loss compactFeedback'}>
                <h2>{practiceFeedback.outcome === 'win' ? '本轮你获胜' : '本轮你未获胜'}</h2>
                <p>
                  {practiceFeedback.outcome === 'win'
                    ? '练习账户被扣除 ' + practiceFeedback.deductedFromPracticeOpponent + ' 分'
                    : '你被扣除 ' + practiceFeedback.deductedFromSelf + ' 分'}
                </p>
                <button className="primary onlineWideButton" disabled={busy} onClick={continuePractice}>
                  {practiceIndex === 2 ? '完成练习，阅读规则' : '下一轮练习'}
                </button>
              </div>
            )}
          </section>
        )}

        {step === 'rules' && (
          <section>
            <p className="onlineEyebrow">步骤3 · 正式任务规则</p>
            <h2>请理解积分规则</h2>
            <div className="partnerDisclosureCard">
              <strong>关于任务伙伴B</strong>
              <p>接下来，系统将为你分配一名任务同伴B。你将与这名同伴共同完成多轮积分游戏。</p>
              <p>为保证每位参与者的实验过程具有可比性，任务同伴B会按照预设规则作出选择。任务开始后，伙伴B将保持不变，请根据自己的真实判断作出选择。</p>
            </div>
            <div className="ruleGrid">
              <div className="ruleCard"><strong>双方初始积分</strong><span>你和伙伴B各有200分。</span></div>
              <div className="ruleCard"><strong>每轮先选择</strong><span>若本轮获胜，扣除B 0—10分。</span></div>
              <div className="ruleCard"><strong>随后比反应</strong><span>获胜者执行自己的选择，失败者不会执行。</span></div>
              <div className="ruleCard"><strong>扣分不影响胜负</strong><span>高扣分不会提高胜率，也不会增加自己的积分或奖励。</span></div>
            </div>
            <p className="muted onlineRuleNote">
              0表示不扣分；双方积分不是总排名，扣除B的积分不会转入你的账户。
            </p>
            <SelectField label="1. 选择0分表示什么？" value={zeroMeaning} onChange={(value) => setZeroMeaning(value as PreflightAnswer['zeroMeaning'] | '')}>
              <option value="">请选择</option>
              <option value="no_deduction">如果获胜，不扣除伙伴B的积分</option>
              <option value="deduct_one">如果获胜，仍扣除伙伴B 1分</option>
              <option value="skip_trial">直接跳过本轮，不再比较反应速度</option>
            </SelectField>
            <SelectField label="2. 如果你获胜，选择的分数从谁的账户扣除？" value={winnerTarget} onChange={(value) => setWinnerTarget(value as PreflightAnswer['winnerTarget'] | '')}>
              <option value="">请选择</option>
              <option value="self">我自己</option>
              <option value="partner">伙伴B</option>
              <option value="both">双方</option>
            </SelectField>
            <SelectField label="3. 如果你失败，扣除你积分的数值来自哪里？" value={loserSource} onChange={(value) => setLoserSource(value as PreflightAnswer['loserSource'] | '')}>
              <option value="">请选择</option>
              <option value="own_choice">我这一轮的选择</option>
              <option value="partner_choice">伙伴B的选择</option>
              <option value="random">完全随机</option>
            </SelectField>
            <SelectField label="4. 选择10分是否会使你更容易赢得本轮？" value={choiceAffectsWin} onChange={(value) => setChoiceAffectsWin(value as PreflightAnswer['choiceAffectsWin'] | '')}>
              <option value="">请选择</option>
              <option value="no">不会，扣分不影响胜负</option>
              <option value="yes">会，10分最容易获胜</option>
              <option value="only_high">只有7—10分会提高胜率</option>
            </SelectField>
            {preflightMessage && <div className="qualityWarning">{preflightMessage}</div>}
            <button className="primary onlineWideButton" disabled={busy || preflightHistory.length >= 5} onClick={submitPreflight}>
              {busy ? '正在检查…' : '提交规则检查'}
            </button>
          </section>
        )}

        {step === 'scenario' && session && (
          <section>
            <p className="onlineEyebrow">步骤4 · 情境任务</p>
            <h2>请想象这件事发生在你身上</h2>
            <div className="scenarioCard">
              <p>
                这学期，你和伙伴B两人一组完成一门核心课程的实践项目。项目开始前，你们约定各自承担一半任务。老师说明，项目完成后，两个人获得相同的小组成绩。
              </p>
              {session.conditionX === 'freeride' ? (
                <>
                  <p>项目进行过程中，你按时完成了自己的资料整理和数据分析。伙伴B多次拖延，没有完成约定的企业访谈和报告整理。</p>
                  <p>为了按时提交，你又补做了伙伴B没有完成的大部分工作。伙伴B只在提交前进行了少量修改。</p>
                </>
              ) : (
                <>
                  <p>项目进行过程中，你按时完成了资料整理和数据分析，伙伴B也按时完成了企业访谈和报告整理。</p>
                  <p>你们都完成了事先约定的任务，投入的时间和工作量大致相当，并一起完成了最后的检查。</p>
                </>
              )}
              <p>项目最终获得90分。老师按照小组整体成果评分，没有另外区分两个人的个人成绩，因此你和伙伴B都获得90分。</p>
              <p>接下来，你还要和同一位伙伴B一起完成一个反应速度小游戏。</p>
            </div>
            <SelectField label="1. 项目开始前，你和伙伴B是怎样约定分工的？" value={scenarioDivision} onChange={(value) => setScenarioDivision(value as ScenarioAnswer['division'] | '')}>
              <option value="">请选择</option>
              <option value="each_half">两个人各承担一半任务</option>
              <option value="self_only">全部任务由我承担</option>
              <option value="b_only">全部任务由伙伴B承担</option>
            </SelectField>
            <SelectField label="2. 实际完成项目时，双方的贡献情况是怎样的？" value={scenarioContribution} onChange={(value) => setScenarioContribution(value as ScenarioAnswer['contribution'] | '')}>
              <option value="">请选择</option>
              <option value="self_most">我完成了主要工作，B贡献很少</option>
              <option value="both">我和B都按分工完成了工作</option>
              <option value="b_most">B完成了主要工作</option>
            </SelectField>
            <SelectField label="3. 项目最终成绩是怎样的？" value={scenarioFinalScore} onChange={(value) => setScenarioFinalScore(value as ScenarioAnswer['finalScore'] | '')}>
              <option value="">请选择</option>
              <option value="both_90">我和伙伴B都获得90分</option>
              <option value="self_90">只有我获得90分</option>
              <option value="b_90">只有伙伴B获得90分</option>
            </SelectField>
            {scenarioMessage && <div className="qualityWarning">{scenarioMessage}</div>}
            <button className="primary onlineWideButton" disabled={busy} onClick={submitScenario}>
              {busy ? '正在检查…' : '确认并继续'}
            </button>
          </section>
        )}

        {step === 'rd' && (
          <section>
            <p className="onlineEyebrow">步骤5 · 此刻感受</p>
            <h2>请根据此刻的真实感受作答</h2>
            <p className="muted onlineRuleNote">1表示“非常不同意”，7表示“非常同意”。</p>
            {RD_ITEMS.map((item, index) => (
              <ScaleField
                key={item}
                label={item}
                value={rdAnswers[index]}
                onChange={(value) => setRdAnswers((current) => current.map((answer, target) => target === index ? value : answer))}
                left="非常不同意"
                right="非常同意"
              />
            ))}
            <button className="primary onlineWideButton" disabled={busy} onClick={submitRd}>
              {busy ? '正在保存…' : '继续'}
            </button>
          </section>
        )}

        {step === 'm' && (
          <section>
            <p className="onlineEyebrow">步骤6 · 对接下来游戏的看法</p>
            <h2>请判断你对下面说法的同意程度</h2>
            <p className="muted onlineRuleNote">
              这些说法都与接下来你和伙伴B进行的游戏有关。请根据你现在的真实想法作答，没有标准答案。1表示“非常不同意”，7表示“非常同意”。
            </p>
            {config?.dataRole === 'test' && (
              <div className="candidateMeasureBanner">内部测试说明：以下题目是本研究正在审查的候选题目，正式页面不会显示这行说明。</div>
            )}
            {mOrder.map((item) => (
              <ScaleField
                key={item.key}
                label={item.text}
                value={mAnswers[item.key]}
                onChange={(value) => setMAnswers({ ...mAnswers, [item.key]: value })}
                left="非常不同意"
                right="非常同意"
              />
            ))}
            <button className="primary onlineWideButton" disabled={busy} onClick={submitM}>
              {busy ? '正在保存…' : '继续'}
            </button>
          </section>
        )}

        {step === 'regulation' && session && (
          <section>
            <p className="onlineEyebrow">步骤7 · 接下来的任务</p>
            <h2>进入游戏前</h2>
            <div className="regulationCard">
              {session.conditionW === 'reappraisal' ? (
                <>
                  <p><strong>请把自己代入刚才的经历：</strong></p>
                  {session.conditionX === 'freeride' ? (
                    <p>你按约定完成了自己的工作，还补做了伙伴B没有完成的大部分任务，最后却和伙伴B得到相同的90分。遇到这种情况，感到生气、委屈或者不公平，都是很自然的。</p>
                  ) : (
                    <p>你和伙伴B都按约定完成了自己的工作，投入大致相当，最后两个人都得到90分。面对这次合作和结果，你可能会有自己的想法和感受。</p>
                  )}
                  <p><strong>现在，请试着这样看待这件事：</strong></p>
                  {session.conditionX === 'freeride' ? (
                    <p>伙伴B没有完成约定的工作，这是已经发生的事实；两个人得到相同分数，是因为这次小组评分只看整体成果，没有区分各自的实际投入。伙伴B得到同样的分数，并不会减少你真正完成的工作，也不会改变你在过程中表现出的责任心和能力。这次分数只是对项目结果的一次评价，并不是对你个人能力和价值的完整判断；你付出的努力、完成的工作和获得的经验仍然属于你。</p>
                  ) : (
                    <p>你和伙伴B都完成了约定的工作，这是已经发生的事实；两个人得到相同分数，是老师按照小组整体成果评分的结果，也与双方大致相当的投入一致。这次结果反映的是你们共同完成的项目，并不是对某一个人全部能力的评价。你在过程中完成的工作和获得的经验仍然属于你。这次项目只代表一次合作，不必提前推断伙伴B接下来会怎样做。</p>
                  )}
                  <p>接下来的小游戏是一次新的互动。请带着这个角度进入游戏，根据游戏中实际发生的情况，按照自己的真实判断作出选择。</p>
                </>
              ) : (
                <>
                  <p><strong>请把自己代入刚才的经历：</strong></p>
                  {session.conditionX === 'freeride' ? (
                    <p>你按约定完成了自己的工作，还补做了伙伴B没有完成的大部分任务，最后却和伙伴B得到相同的90分。遇到这种情况，感到生气、委屈或者不公平，都是很自然的。</p>
                  ) : (
                    <p>你和伙伴B都按约定完成了自己的工作，投入大致相当，最后两个人都得到90分。面对这次合作和结果，你可能会有自己的想法和感受。</p>
                  )}
                  <p><strong>接下来，请按照平时的方式完成：</strong></p>
                  <p>保持自己此刻自然产生的想法和感受，不需要刻意改变自己的看法，也不需要调整或压下自己的情绪。无论你现在有什么感受，都请按照平时的方式进入游戏，并根据自己的真实判断作出选择。</p>
                </>
              )}
            </div>
            <button className="primary onlineWideButton" disabled={busy} onClick={submitRegulation}>
              {busy ? '正在进入…' : '我已阅读，进入游戏'}
            </button>
          </section>
        )}

        {step === 'task' && session && (
          <section className="taskShell">
            <div className="taskProgressHeader">
              <div>
                <p className="onlineEyebrow">步骤8 · 第 {Math.min(currentTrialNumber, session.totalTrials)} / {session.totalTrials} 轮</p>
                <h2>{isInitial ? '积分决策阶段' : '双方互动阶段'}</h2>
              </div>
              <div className="balanceGrid">
                <div><span>我的积分</span><strong>{session.participantPoints}</strong></div>
                <div><span>伙伴B</span><strong>{session.opponentPoints}</strong></div>
              </div>
            </div>
            <div className="progressTrack"><span style={{ width: taskProgress + '%' }} /></div>

            {taskPhase === 'choose' && (
              <div className="choicePanel">
                {session.pendingDraft && (
                  <div className="savedDraftNotice">
                    已恢复本轮暂存选择：{session.pendingDraft.participant_deduction_choice}分。为保持数据一致，本轮不能重新选择。
                  </div>
                )}
                <p className="choicePrompt">如果本轮获胜，你选择扣除伙伴B多少积分？</p>
                <PointGrid
                  value={choice}
                  onChange={setChoice}
                  disabled={Boolean(session.pendingDraft)}
                />
                <button className="primary onlineWideButton" disabled={choice == null} onClick={beginTrial}>
                  {session.pendingDraft ? '继续本轮反应任务' : '确认选择并暂存'}
                </button>
              </div>
            )}

            {(taskPhase === 'drafting' || taskPhase === 'waiting') && (
              <div className="reactionStage">
                <div className="waitOrb" aria-hidden="true" />
                <h2>{taskPhase === 'drafting' ? '正在保存本轮选择…' : '请等待…'}</h2>
                <p>看到“立即点击”后，请尽快点击按钮。</p>
              </div>
            )}

            {(taskPhase === 'go' || taskPhase === 'saving') && (
              <div className="reactionStage">
                <button className="goButton" disabled={taskPhase === 'saving'} onPointerDown={respondGo}>
                  {taskPhase === 'saving' ? '正在结算…' : '立即点击'}
                </button>
              </div>
            )}

            {taskPhase === 'feedback' && feedbackTrial && (
              <div className={feedbackTrial.planned_outcome === 'win' ? 'roundFeedback win' : 'roundFeedback loss'}>
                <p className="onlineEyebrow">本轮结果</p>
                <h2>{feedbackTrial.planned_outcome === 'win' ? '你赢了' : '伙伴B赢了'}</h2>
                <p className="deductionLine">
                  {feedbackTrial.planned_outcome === 'win'
                    ? '伙伴B被扣除 ' + feedbackTrial.deducted_from_opponent + ' 分'
                    : '你被扣除 ' + feedbackTrial.deducted_from_participant + ' 分'}
                </p>
                <button className="primary onlineWideButton" onClick={nextTrial}>
                  {session.flowStage === 'checks' ? '进入最后几个问题' : '下一轮'}
                </button>
              </div>
            )}

            {taskPhase === 'reminder' && (
              <div className="regulationReminder">
                <p className="onlineEyebrow">你已完成前7轮</p>
                <h2>接下来，双方将继续互动</h2>
                <p>你刚刚看到了第7轮的结果。伙伴B在这一轮扣除了你的积分。</p>
                <p>
                  {session.conditionW === 'reappraisal'
                    ? '这是游戏中已经发生的一轮结果，但它不能预先决定伙伴B后面每一轮会怎样选择。请继续根据后续每一轮实际发生的情况，作出自己的选择。'
                    : '请保持此刻自然产生的想法和感受，不需要刻意改变，并按照平时的方式完成后面的每一轮。'}
                </p>
                <button className="primary onlineWideButton" disabled={busy} onClick={acknowledgeReminder}>
                  {busy ? '正在保存…' : '继续游戏'}
                </button>
              </div>
            )}
          </section>
        )}

        {step === 'checks' && (
          <section>
            <p className="onlineEyebrow">步骤9 · 完成游戏后的问题</p>
            <h2>请根据刚才的真实经历作答</h2>
            <h3 className="checkSectionTitle">游戏前和互动中的想法</h3>
            {[
              '进入游戏前，我想到过：两个人都得到90分，是因为老师按照小组整体成果评分。',
              '在游戏过程中，我曾提醒自己：课程项目和积分游戏是两件不同的事。',
              '第7轮被伙伴B扣分后，我曾提醒自己：这只是一轮的结果，伙伴B后面不一定还会这样选择。',
            ].map((label, index) => (
              <ScaleField
                key={label}
                label={label}
                value={regulationCheck[index]}
                onChange={(value) => setRegulationCheck((current) => current.map((answer, target) => target === index ? value : answer))}
                left="完全不同意"
                right="完全同意"
              />
            ))}
            <h3 className="checkSectionTitle">选择动机</h3>
            <ScaleField label="伙伴B扣除我的积分后，我曾想通过提高扣分来反击B" value={motiveRetaliation} onChange={setMotiveRetaliation} left="完全不同意" right="完全同意" />
            <ScaleField label="即使扣除伙伴B的积分不会增加我的积分，我仍有过让B多损失一些积分的想法" value={motiveHarm} onChange={setMotiveHarm} left="完全不同意" right="完全同意" />
            <ScaleField label="在游戏过程中，我觉得选择更高的扣分会让自己更容易赢" value={motiveWinBelief} onChange={setMotiveWinBelief} left="完全不同意" right="完全同意" />
            <ScaleField label="我连续选择相同的扣分数字，有时只是因为这样比较省事" value={motiveConvenience} onChange={setMotiveConvenience} left="完全不同意" right="完全同意" />
            <ScaleField label="看到自己的积分落后于伙伴B时，我更想提高对B的扣分" value={motiveScoreGap} onChange={setMotiveScoreGap} left="完全不同意" right="完全同意" />
            <h3 className="checkSectionTitle">任务投入和完成情况</h3>
            <ScaleField label="在游戏过程中，我会根据伙伴B对我的扣分情况，调整自己下一轮的扣分选择" value={feedbackResponsiveness} onChange={setFeedbackResponsiveness} left="完全不同意" right="完全同意" />
            <ScaleField label="我认为，自己获胜时选择的扣分数，会实际影响伙伴B在游戏中的积分" value={believedChoiceAffectedOpponent} onChange={setBelievedChoiceAffectedOpponent} left="完全不同意" right="完全同意" />
            <ScaleField label="游戏结束时自己的最终积分，对我来说有多重要？" value={rewardConsequenceImportance} onChange={setRewardConsequenceImportance} left="完全不重要" right="非常重要" />
            <ScaleField label="总体来说，我认真完成了这项任务" value={seriousCompletion} onChange={setSeriousCompletion} left="完全不同意" right="完全同意" />
            <ScaleField label="完成任务期间，设备、网络、他人或周围环境对我造成了多大干扰？" value={interruptionLevel} onChange={setInterruptionLevel} left="完全没有干扰" right="干扰非常大" />
            <button className="primary onlineWideButton" disabled={busy} onClick={completeSession}>
              {busy ? '正在提交…' : '提交完整测试'}
            </button>
          </section>
        )}

        {step === 'done' && (
          <section className="debriefPanel">
            <div className="doneMark">✓</div>
            <h1>完整流程测试已完成</h1>
            <div className="debriefBox">
              <h2>事后说明</h2>
              <p>
                正如任务开始前所说明的，伙伴B并非另一位实时参与者。为保证每位参与者经历相同条件，伙伴B、每轮胜负和B的扣分均由程序按照统一规则预先设定。
                情境与互动任务用于研究不公平经历、思考方式和互动选择之间的关系。
              </p>
              <p>当前是内部技术测试，积分不对应真实奖励。正式版的数据撤回期限、研究者联系方式和奖励规则仍待伦理确认。</p>
            </div>
            <p className="muted">现在可以安全关闭页面。</p>
          </section>
        )}
      </main>

      <footer className="footer muted">
        研究二完整流程测试 · {config?.studyVersion || '正在读取版本'}
      </footer>
    </div>
  )
}

function SetupCheck({
  checked,
  text,
  onChange,
}: {
  checked: boolean
  text: string
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="checkbox setupCheck">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{text}</span>
    </label>
  )
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  )
}

function PointGrid({
  value,
  onChange,
  disabled = false,
}: {
  value: number | null
  onChange: (value: number) => void
  disabled?: boolean
}) {
  return (
    <>
      <div className="pointChoiceGrid">
        {Array.from({ length: 11 }, (_, option) => (
          <button
            key={option}
            type="button"
            className={value === option ? 'pointChoice selected' : 'pointChoice'}
            aria-pressed={value === option}
            disabled={disabled}
            onClick={() => onChange(option)}
          >
            {option}
          </button>
        ))}
      </div>
      <p className="muted pointAnchor"><span>0 = 不扣分</span><span>10 = 扣分最多</span></p>
    </>
  )
}

function ScaleField({
  label,
  value,
  onChange,
  left,
  right,
}: {
  label: string
  value: number | null
  onChange: (value: number) => void
  left: string
  right: string
}) {
  return (
    <div className="scaleField">
      <span className="label">{label}</span>
      <div className="scaleButtons">
        {Array.from({ length: 7 }, (_, index) => index + 1).map((option) => (
          <button
            key={option}
            type="button"
            className={value === option ? 'scaleButton selected' : 'scaleButton'}
            aria-pressed={value === option}
            onClick={() => onChange(option)}
          >
            {option}
          </button>
        ))}
      </div>
      <span className="scaleAnchors"><span>{left}</span><span>{right}</span></span>
    </div>
  )
}

export default FullStudyApp
