import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import './App.css'
import { apiFetch } from './api'

type CrttPlanItem = {
  trialIndex: number
  outcome: 'win' | 'loss'
  opponent: null | { intensity: number; durationMs: number }
}

type FormalTrialPayload = {
  trialIndex: number
  outcome: 'win' | 'loss'
  participantRtMs: number | null
  participantIntensity: number
  participantDurationMs: number
  opponentIntensity: number | null
  opponentDurationMs: number | null
}

type BrowserWindowWithWebkitAudio = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext
  }

type Step = 'login' | 'hook' | 'crtt' | 'manipulation' | 'done'

type InviteGate = 'none' | 'loading' | 'ok' | 'error'
type CrttMode = 'practice' | 'formal'

const INTENSITY_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const
const DURATION_OPTIONS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5] as const
const PRACTICE_PLAN: CrttPlanItem[] = [
  { trialIndex: 0, outcome: 'loss', opponent: { intensity: 4, durationMs: 800 } },
  { trialIndex: 1, outcome: 'win', opponent: null },
]
const PRACTICE_VALID_RT_MIN_MS = 100
const PRACTICE_VALID_RT_MAX_MS = 3000
const PRACTICE_MIN_VALID_RT_COUNT = 1
const FEEDBACK_WIN_MS = 2200
const FEEDBACK_LOSS_MIN_MS = 3200
const MIN_SELECTION_REVIEW_MS = 800
const REPEATED_CHOICE_WARNING_COUNT = 5
const MANIPULATION_ITEMS = [
  {
    key: 'unfriendly',
    text: '我觉得游戏伙伴 B 在任务中对我不太友好。',
  },
  {
    key: 'provoked',
    text: '我觉得自己在任务中受到了游戏伙伴 B 的挑衅。',
  },
  {
    key: 'punishmentHeavy',
    text: '我觉得游戏伙伴 B 给我设定的声音惩罚偏重。',
  },
  {
    key: 'angry',
    text: '我在任务过程中感到生气。',
  },
  {
    key: 'retaliation',
    text: '我在任务过程中有想反击游戏伙伴 B 的冲动。',
  },
] as const
type ManipulationKey = (typeof MANIPULATION_ITEMS)[number]['key']
type ManipulationAnswers = Record<ManipulationKey, number | null>

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function isLikelyMobileAudio(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  if (navigator.maxTouchPoints > 1) return true
  if (window.matchMedia?.('(pointer: coarse)').matches) return true
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
}

/** 微信内置浏览器：Web Audio 惩罚音常被系统拦截，实验数据可能无效 */
function isWeChatInApp(): boolean {
  if (typeof navigator === 'undefined') return false
  return /MicroMessenger/i.test(navigator.userAgent)
}

function readInviteTokenFromUrl(): string | null {
  const url = new URL(window.location.href)
  return url.searchParams.get('invite') || url.searchParams.get('i')
}

/** 与研究一编号对齐：问卷跳转或独立链接上的常见参数名，见 README。 */
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

function App() {
  const [step, setStep] = useState<Step>('login')
  const [participantId, setParticipantId] = useState(() => readPidFromUrl())
  const [participantIdLocked, setParticipantIdLocked] = useState(false)
  const [inviteGate, setInviteGate] = useState<InviteGate>(() =>
    readInviteTokenFromUrl() ? 'loading' : 'none'
  )
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [consented, setConsented] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)
  /** 研究二首页：点过「开始」后，对未填项标红 */
  const [loginAttempted, setLoginAttempted] = useState(false)

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [plan, setPlan] = useState<CrttPlanItem[] | null>(null)

  const [audioEnabled, setAudioEnabled] = useState(false)
  /** 被试确认已将系统媒体音量调到可感知惩罚；网页无法代为检测或强制系统音量 */
  const [volumeConfirmed, setVolumeConfirmed] = useState(false)
  const audioRef = useRef<{
    ctx: AudioContext
    master: GainNode
  } | null>(null)

  const [hookStartIso, setHookStartIso] = useState<string | null>(null)
  const [anger, setAnger] = useState<number>(5)
  const [hookCanContinue, setHookCanContinue] = useState(false)
  const [hookSecondsLeft, setHookSecondsLeft] = useState<number | null>(null)

  const [trialIndex, setTrialIndex] = useState(0)
  const [crttMode, setCrttMode] = useState<CrttMode>('practice')
  const [intensity, setIntensity] = useState<number | null>(null)
  const [durationSec, setDurationSec] = useState<number | null>(null)
  const [phase, setPhase] = useState<'set' | 'wait' | 'go' | 'feedback' | 'practiceComplete'>(
    'set'
  )
  const [goAt, setGoAt] = useState<number | null>(null)
  const [rtMs, setRtMs] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [trialSaving, setTrialSaving] = useState(false)
  const [pendingFormalTrial, setPendingFormalTrial] = useState<{
    payload: FormalTrialPayload
    nextIndex: number
  } | null>(null)
  const [selectionReviewReady, setSelectionReviewReady] = useState(false)
  const [choiceWarning, setChoiceWarning] = useState<string | null>(null)
  const [choiceWarningAcknowledgedFor, setChoiceWarningAcknowledgedFor] = useState<string | null>(
    null
  )
  const [formalChoiceHistory, setFormalChoiceHistory] = useState<string[]>([])
  const [manipulationAnswers, setManipulationAnswers] = useState<ManipulationAnswers>({
    unfriendly: null,
    provoked: null,
    punishmentHeavy: null,
    angry: null,
    retaliation: null,
  })
  const [manipulationAttempted, setManipulationAttempted] = useState(false)
  const [practiceRtList, setPracticeRtList] = useState<number[]>([])
  const [practicePassResult, setPracticePassResult] = useState<{
    passed: boolean
    validCount: number
  } | null>(null)
  const practiceRtListRef = useRef<number[]>([])

  const goReactionHandledRef = useRef(false)
  const commitGoReactionRef = useRef<() => void>(() => {})
  const [waitRemainingSec, setWaitRemainingSec] = useState<number | null>(null)
  const waitTimersRef = useRef<{ ui?: number; go?: number }>({})

  async function ensureAudioReady() {
    if (!audioRef.current) {
      const audioWindow = window as BrowserWindowWithWebkitAudio
      const AudioCtor = audioWindow.AudioContext || audioWindow.webkitAudioContext
      if (!AudioCtor) throw new Error('audio_context_unavailable')
      const ctx = new AudioCtor()
      const master = ctx.createGain()
      master.gain.value = isLikelyMobileAudio() ? 0.38 : 0.22
      master.connect(ctx.destination)
      audioRef.current = { ctx, master }
    }
    if (audioRef.current.ctx.state !== 'running') {
      await audioRef.current.ctx.resume()
    }
    return audioRef.current
  }

  /**
   * 必须在用户手势（click / pointerdown）的同步调用栈里执行，否则 iOS Safari 会保持
   * AudioContext suspended，导致后续惩罚音无声。
   */
  function syncUnlockAudioOnUserGesture() {
    try {
      if (!audioRef.current) {
        const audioWindow = window as BrowserWindowWithWebkitAudio
        const AudioCtor = audioWindow.AudioContext || audioWindow.webkitAudioContext
        if (!AudioCtor) return
        const ctx = new AudioCtor()
        const master = ctx.createGain()
        master.gain.value = isLikelyMobileAudio() ? 0.38 : 0.22
        master.connect(ctx.destination)
        audioRef.current = { ctx, master }
      }
      const { ctx } = audioRef.current
      const st = ctx.state as string
      if (st === 'suspended' || st === 'interrupted') void ctx.resume()
    } catch {
      // ignore
    }
  }

  /** 从后台/来电返回时尽力恢复；真正播放惩罚音仍依赖下一次手势里的 resume + then */
  function reviveAudioAfterBackground() {
    try {
      const ctx = audioRef.current?.ctx
      if (!ctx || ctx.state === 'closed') return
      if (ctx.state !== 'running') void ctx.resume().catch(() => {})
    } catch {
      // ignore
    }
  }

  function intensityToGain(intensity01to10: number) {
    // Browser volume is not calibrated dB. We cap for safety.
    const x = Math.min(10, Math.max(1, intensity01to10))
    // Map 1..10 -> ~0.02..0.25 (soft to noticeable, not painfully loud)
    const min = 0.02
    const max = isLikelyMobileAudio() ? 0.34 : 0.25
    const t = (x - 1) / 9
    return min + t * (max - min)
  }

  async function enableAudio() {
    try {
      syncUnlockAudioOnUserGesture()
      await ensureAudioReady()
      playPreviewBeep()
      setAudioEnabled(true)
      setVolumeConfirmed(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'audio_enable_failed')
    }
  }

  function playPreviewBeep(loud = false) {
    const a = audioRef.current
    if (!a) return
    const { ctx, master } = a
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.value = loud ? 660 : 880
    g.gain.value = 0
    osc.connect(g)
    g.connect(master)
    const t0 = ctx.currentTime
    g.gain.setValueAtTime(0, t0)
    const peak = loud
      ? isLikelyMobileAudio()
        ? 0.38
        : 0.26
      : isLikelyMobileAudio()
        ? 0.2
        : 0.12
    g.gain.linearRampToValueAtTime(peak, t0 + 0.01)
    g.gain.linearRampToValueAtTime(0, t0 + (loud ? 0.28 : 0.16))
    osc.start(t0)
    osc.stop(t0 + (loud ? 0.3 : 0.18))
  }

  /**
   * 与惩罚白噪音同时触发。Web Vibration API 无标准「强度」参数，用脉冲长短与间隔疏密近似响度；
   * 总时长对齐惩罚 duration（有浏览器对 pattern 长度/总时长的上限，故做截断）。
   */
  function vibratePunishment(intensity01to10: number, durationMs: number) {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
    const total = Math.min(5000, Math.max(0, Math.round(durationMs)))
    if (total <= 0) return
    const lvl = Math.min(10, Math.max(1, Math.round(intensity01to10)))
    const pulseMs = Math.round(40 + lvl * 16)
    const gapMs = Math.max(12, Math.round(100 - lvl * 8))
    const pattern: number[] = []
    let used = 0
    while (used < total && pattern.length < 40) {
      const vib = Math.min(pulseMs, total - used)
      if (vib < 1) break
      pattern.push(vib)
      used += vib
      if (used >= total) break
      const gap = Math.min(gapMs, total - used)
      if (gap < 1) break
      pattern.push(gap)
      used += gap
    }
    try {
      navigator.vibrate(0)
      navigator.vibrate(pattern.length ? pattern : [Math.min(300, total)])
    } catch {
      // ignore
    }
  }

  function playWhiteNoise({ gain, durationMs }: { gain: number; durationMs: number }) {
    const a = audioRef.current
    if (!a) return
    const { ctx, master } = a
    const dur = Math.min(5000, Math.max(0, durationMs))
    if (dur <= 0) return

    const bufferSize = Math.floor(ctx.sampleRate * (dur / 1000))
    const buffer = ctx.createBuffer(1, Math.max(1, bufferSize), ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

    const source = ctx.createBufferSource()
    source.buffer = buffer

    // Band-limit a bit to be less harsh.
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 8000

    const g = ctx.createGain()
    g.gain.value = 0

    source.connect(filter)
    filter.connect(g)
    g.connect(master)

    const t0 = ctx.currentTime
    const attack = 0.02
    const release = 0.04
    const cap = isLikelyMobileAudio() ? 0.52 : 0.35
    const target = Math.min(cap, Math.max(0, gain))
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(target, t0 + attack)
    g.gain.setValueAtTime(target, t0 + Math.max(attack, dur / 1000 - release))
    g.gain.linearRampToValueAtTime(0, t0 + dur / 1000)

    source.start()
    source.stop(t0 + dur / 1000 + 0.01)
  }

  /**
   * 仅在手势回调里调用。来电/切后台后 context 常为 suspended：须先 resume，
   * 并在 resume 完成后再调度白噪音，否则后续多轮会无声。
   */
  function punishmentFeedbackFromUserGesture(intensity: number, durationMs: number) {
    try {
      syncUnlockAudioOnUserGesture()
      const a = audioRef.current
      if (!a) return
      const { ctx } = a
      const gain = intensityToGain(intensity)
      const play = () => {
        try {
          playWhiteNoise({ gain, durationMs })
        } catch {
          // ignore
        }
      }
      if (ctx.state === 'running') play()
      else void ctx.resume().then(play).catch(play)
    } catch {
      // ignore
    }
    vibratePunishment(intensity, durationMs)
  }

  useEffect(() => {
    document.title = '研究二 · 实验任务'
  }, [])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      reviveAudioAfterBackground()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [])

  useEffect(() => {
    const token = readInviteTokenFromUrl()
    if (!token) return

    let cancelled = false
    ;(async () => {
      try {
        const r = await apiFetch(`/api/invite/${encodeURIComponent(token)}`)
        if (cancelled) return
        if (r.status === 404) {
          setInviteGate('error')
          setInviteError('邀请链接无效。')
          return
        }
        if (r.status === 410) {
          setInviteGate('error')
          setInviteError('邀请链接已失效、已用完或已过期。')
          return
        }
        if (!r.ok) {
          setInviteGate('error')
          setInviteError(`无法验证邀请链接（HTTP ${r.status}）。`)
          return
        }
        const data = (await r.json()) as {
          ok?: boolean
          participantId?: string | null
        }
        if (!data.ok) {
          setInviteGate('error')
          setInviteError('邀请链接无效。')
          return
        }
        if (data.participantId) {
          setParticipantId(data.participantId)
          setParticipantIdLocked(true)
        }
        setInviteGate('ok')
      } catch {
        if (!cancelled) {
          setInviteGate('error')
          setInviteError('无法验证邀请链接（网络错误）。')
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    practiceRtListRef.current = practiceRtList
  }, [practiceRtList])

  useEffect(() => {
    setChoiceWarning(null)
    setChoiceWarningAcknowledgedFor(null)
    if (phase !== 'set' || intensity == null || durationSec == null) {
      setSelectionReviewReady(false)
      return
    }
    setSelectionReviewReady(false)
    const id = window.setTimeout(() => {
      setSelectionReviewReady(true)
    }, MIN_SELECTION_REVIEW_MS)
    return () => window.clearTimeout(id)
  }, [phase, intensity, durationSec])

  /** 环节一：阅读至少 60 秒；useLayoutEffect 保证首屏即有倒计时 */
  useLayoutEffect(() => {
    if (step !== 'hook') {
      setHookSecondsLeft(null)
      return
    }
    let ticks = 60
    setHookSecondsLeft(60)
    setHookCanContinue(false)
    const id = window.setInterval(() => {
      ticks -= 1
      setHookSecondsLeft(Math.max(0, ticks))
      if (ticks <= 0) {
        window.clearInterval(id)
        setHookCanContinue(true)
      }
    }, 1000)
    return () => window.clearInterval(id)
  }, [step, hookStartIso])

  function clearWaitTimers() {
    const t = waitTimersRef.current
    if (t.ui != null) window.clearInterval(t.ui)
    if (t.go != null) window.clearTimeout(t.go)
    waitTimersRef.current = {}
  }

  useEffect(() => {
    return () => clearWaitTimers()
  }, [])

  useEffect(() => {
    if (step !== 'crtt') {
      clearWaitTimers()
      setWaitRemainingSec(null)
    }
  }, [step])

  function scrollToFirstLoginFieldError() {
    window.requestAnimationFrame(() => {
      const root = document.querySelector('main.card')
      const el = root?.querySelector<HTMLElement>('.fieldErrorInput, .fieldErrorBox')
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  function tryStartSession() {
    setLoginAttempted(true)
    setError(null)
    const inv = readInviteTokenFromUrl()
    if (isWeChatInApp()) return
    if (inv != null && inviteGate !== 'ok') return
    if (
      participantId.trim().length < 1 ||
      !consented ||
      !audioEnabled ||
      (audioEnabled && !volumeConfirmed)
    ) {
      scrollToFirstLoginFieldError()
      return
    }
    void startSession()
  }

  async function startSession() {
    if (audioEnabled) syncUnlockAudioOnUserGesture()
    setBusy(true)
    setError(null)
    try {
      const inv = readInviteTokenFromUrl()
      const r = await apiFetch('/api/session/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          participantId: participantId.trim(),
          userAgent: navigator.userAgent,
          inviteToken: inv ?? undefined,
        }),
      })
      if (!r.ok) throw new Error(`start_failed_${r.status}`)
      const data = (await r.json()) as { sessionId: string; plan: CrttPlanItem[] }
      setSessionId(data.sessionId)
      setPlan(data.plan)
      setHookCanContinue(false)
      setHookSecondsLeft(60)
      setStep('hook')
      const t = new Date().toISOString()
      setHookStartIso(t)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'start_failed')
    } finally {
      setBusy(false)
    }
  }

  async function submitHook() {
    if (!sessionId) return
    setBusy(true)
    setError(null)
    try {
      const end = new Date().toISOString()
      const r = await apiFetch('/api/session/hook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          hookReadStartedAt: hookStartIso ?? undefined,
          hookReadEndedAt: end,
          angerRating: anger,
        }),
      })
      if (!r.ok) throw new Error(`hook_failed_${r.status}`)
      setStep('crtt')
      setCrttMode('practice')
      setTrialIndex(0)
      setIntensity(null)
      setDurationSec(null)
      setPhase('set')
      setFeedback(null)
      setGoAt(null)
      setRtMs(null)
      setPracticeRtList([])
      practiceRtListRef.current = []
      setPracticePassResult(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'hook_failed')
    } finally {
      setBusy(false)
    }
  }

  async function submitTrial(payload: FormalTrialPayload) {
    if (!sessionId) throw new Error('missing_session')
    const r = await apiFetch('/api/trial', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, ...payload }),
    })
    if (!r.ok) throw new Error(`trial_failed_${r.status}`)
  }

  async function submitTrialWithRetry(payload: FormalTrialPayload) {
    let lastError: unknown = null
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await submitTrial(payload)
        return
      } catch (e) {
        lastError = e
        await sleep(600 * attempt)
      }
    }
    throw lastError instanceof Error ? lastError : new Error('trial_failed')
  }

  async function saveFormalTrialAndAdvance(
    payload: FormalTrialPayload,
    nextIndex: number,
    feedbackHoldMs: number
  ) {
    setTrialSaving(true)
    setPendingFormalTrial({ payload, nextIndex })
    setError(null)
    try {
      await Promise.all([submitTrialWithRetry(payload), sleep(feedbackHoldMs)])
      setPendingFormalTrial(null)
      finishAndAdvance(nextIndex)
    } catch (e) {
      setError(
        e instanceof Error
          ? `本轮数据保存失败：${e.message}。请检查网络后点击“重新保存本轮数据”，不要刷新或关闭页面。`
          : '本轮数据保存失败。请检查网络后点击“重新保存本轮数据”，不要刷新或关闭页面。'
      )
    } finally {
      setTrialSaving(false)
    }
  }

  async function completeSession() {
    if (!sessionId) return
    setManipulationAttempted(true)
    const completeAnswers = Object.values(manipulationAnswers).every((v) => v != null)
    if (!completeAnswers) {
      setError('请先完成所有感受题，再提交。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const r = await apiFetch('/api/session/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, manipulation: manipulationAnswers }),
      })
      if (!r.ok) throw new Error(`complete_failed_${r.status}`)
      setStep('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'complete_failed')
    } finally {
      setBusy(false)
    }
  }

  function beginFormalCrtt() {
    setCrttMode('formal')
    setTrialIndex(0)
    setIntensity(null)
    setDurationSec(null)
    setPhase('set')
    setFeedback(null)
    setTrialSaving(false)
    setPendingFormalTrial(null)
    setManipulationAttempted(false)
    setGoAt(null)
    setRtMs(null)
    setSelectionReviewReady(false)
    setChoiceWarning(null)
    setChoiceWarningAcknowledgedFor(null)
    setFormalChoiceHistory([])
  }

  function restartPractice() {
    setCrttMode('practice')
    setTrialIndex(0)
    setIntensity(null)
    setDurationSec(null)
    setPhase('set')
    setFeedback(null)
    setTrialSaving(false)
    setPendingFormalTrial(null)
    setGoAt(null)
    setRtMs(null)
    setPracticeRtList([])
    practiceRtListRef.current = []
    setPracticePassResult(null)
    setSelectionReviewReady(false)
    setChoiceWarning(null)
    setChoiceWarningAcknowledgedFor(null)
  }

  function getCurrentPlan() {
    return crttMode === 'practice' ? PRACTICE_PLAN : plan
  }

  function finishAndAdvance(nextIndex: number) {
    const currentPlan = getCurrentPlan()
    if (!currentPlan) return
    if (nextIndex >= currentPlan.length) {
      if (crttMode === 'practice') {
        const validCount = practiceRtListRef.current.filter(
          (rt) => rt >= PRACTICE_VALID_RT_MIN_MS && rt <= PRACTICE_VALID_RT_MAX_MS
        ).length
        const passed = validCount >= PRACTICE_MIN_VALID_RT_COUNT
        setPracticePassResult({ passed, validCount })
        setPhase('practiceComplete')
        setFeedback(null)
        setGoAt(null)
    setRtMs(null)
    setSelectionReviewReady(false)
    setChoiceWarning(null)
    setChoiceWarningAcknowledgedFor(null)
    return
  }
      setStep('manipulation')
      setFeedback(null)
      setGoAt(null)
      setRtMs(null)
      return
    }
    setTrialIndex(nextIndex)
    setIntensity(null)
    setDurationSec(null)
    setPhase('set')
    setFeedback(null)
    setTrialSaving(false)
    setPendingFormalTrial(null)
    setGoAt(null)
    setRtMs(null)
    setSelectionReviewReady(false)
    setChoiceWarning(null)
    setChoiceWarningAcknowledgedFor(null)
  }

  function beginReaction() {
    if (intensity == null || durationSec == null) return
    if (!selectionReviewReady) return
    const pDurMs = Math.round(durationSec * 1000)
    const choiceKey = `${intensity}_${pDurMs}`
    if (crttMode === 'formal') {
      const recent = formalChoiceHistory.slice(-(REPEATED_CHOICE_WARNING_COUNT - 1))
      const wouldReachRepeatedChoice =
        recent.length === REPEATED_CHOICE_WARNING_COUNT - 1 &&
        recent.every((choice) => choice === choiceKey)
      if (wouldReachRepeatedChoice && choiceWarningAcknowledgedFor !== choiceKey) {
        setChoiceWarning(
          `你已经连续多轮选择完全相同的惩罚设置。请根据本轮情境认真选择；如果继续固定作答，数据可能会被标记为无效。若这是你的真实选择，请再点击一次开始本轮。`
        )
        setChoiceWarningAcknowledgedFor(choiceKey)
        return
      }
    }
    setChoiceWarning(null)
    setChoiceWarningAcknowledgedFor(null)
    clearWaitTimers()
    if (audioEnabled) syncUnlockAudioOnUserGesture()
    goReactionHandledRef.current = false
    setPhase('wait')
    setFeedback(null)
    setRtMs(null)
    setGoAt(null)
    // 约 2.2–4.0 秒：过短的随机间隔在手机上看不清「倒计时」
    const delay = 2200 + Math.floor(Math.random() * 1800)
    const start = performance.now()
    setWaitRemainingSec(Math.max(1, Math.ceil(delay / 1000)))
    const ui = window.setInterval(() => {
      const rem = Math.max(0, Math.ceil((start + delay - performance.now()) / 1000))
      setWaitRemainingSec(rem)
    }, 120)
    waitTimersRef.current.ui = ui
    const go = window.setTimeout(() => {
      if (waitTimersRef.current.ui != null) {
        window.clearInterval(waitTimersRef.current.ui)
        waitTimersRef.current.ui = undefined
      }
      setWaitRemainingSec(null)
      goReactionHandledRef.current = false
      setGoAt(performance.now())
      setPhase('go')
      waitTimersRef.current.go = undefined
    }, delay)
    waitTimersRef.current.go = go
  }

  commitGoReactionRef.current = () => {
    if (phase !== 'go' || goAt == null) return
    if (goReactionHandledRef.current) return
    const currentPlan = getCurrentPlan()
    const item = currentPlan?.[trialIndex] ?? null
    if (!item) return
    goReactionHandledRef.current = true

    if (intensity == null || durationSec == null) return

    const rt = Math.max(0, Math.round(performance.now() - goAt))
    setRtMs(rt)
    setPhase('feedback')
    if (crttMode === 'practice') {
      setPracticeRtList((prev) => {
        const next = [...prev, rt]
        practiceRtListRef.current = next
        return next
      })
    }

    const pDurMs = Math.round(durationSec * 1000)
    const opp = item.opponent
    const oppIntensity = opp ? opp.intensity : null
    const oppDur = opp ? opp.durationMs : null

    const baseMsg =
      item.outcome === 'loss'
        ? `这轮你慢了一点，算你输。游戏伙伴 B 在本轮开始前为你设定了声音惩罚：白噪音约 ${oppIntensity} 档响度、${Math.round(
            (oppDur ?? 0) / 100
          ) / 10} 秒。你现在需要接受这段由游戏伙伴 B 设定的声音惩罚。`
        : `这轮你更快，算你赢。游戏伙伴 B 将接受你在本轮开始前设定的声音惩罚：${intensity} 档响度、${durationSec} 秒。`
    const msg = crttMode === 'practice' ? `[练习轮次，不计入正式数据] ${baseMsg}` : baseMsg
    setFeedback(msg)

    if (item.outcome === 'loss' && audioEnabled && oppIntensity != null && oppDur != null) {
      punishmentFeedbackFromUserGesture(oppIntensity, oppDur)
    }

    const feedbackHoldMs =
      item.outcome === 'loss'
        ? Math.max(FEEDBACK_LOSS_MIN_MS, (oppDur ?? 0) + 1600)
        : FEEDBACK_WIN_MS

    if (crttMode === 'formal') {
      setFormalChoiceHistory((prev) => [...prev, `${intensity}_${pDurMs}`].slice(-12))
      void saveFormalTrialAndAdvance(
        {
          trialIndex,
          outcome: item.outcome,
          participantRtMs: rt,
          participantIntensity: intensity,
          participantDurationMs: pDurMs,
          opponentIntensity: oppIntensity,
          opponentDurationMs: oppDur,
        },
        trialIndex + 1,
        feedbackHoldMs
      )
      return
    }

    window.setTimeout(() => finishAndAdvance(trialIndex + 1), feedbackHoldMs)
  }

  function retryPendingFormalTrial() {
    if (!pendingFormalTrial || trialSaving) return
    void saveFormalTrialAndAdvance(pendingFormalTrial.payload, pendingFormalTrial.nextIndex, 0)
  }

  useEffect(() => {
    if (step !== 'crtt' || phase !== 'go') return
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.code !== 'Space') return
      ev.preventDefault()
      commitGoReactionRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [step, phase])

  async function copyCurrentPageUrl() {
    const url = window.location.href
    try {
      await navigator.clipboard.writeText(url)
      setLinkCopied(true)
      window.setTimeout(() => setLinkCopied(false), 2500)
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = url
        ta.style.position = 'fixed'
        ta.style.left = '-9999px'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        setLinkCopied(true)
        window.setTimeout(() => setLinkCopied(false), 2500)
      } catch {
        setError('无法自动复制链接，请长按地址栏手动复制。')
      }
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">研究二 · 实验任务</div>
        <div className="meta" />
      </header>

      <main className={step === 'login' ? 'card loginForm' : 'card'}>
        {error ? <div className="error">出错了：{error}</div> : null}
        {isWeChatInApp() ? (
          <div className="wechatBanner">
            <strong>当前是微信内置浏览器</strong>
            <p className="wechatBannerText">
              研究二的<strong>惩罚白噪音</strong>在微信里经常<strong>完全无法播放</strong>，会导致实验无效。请换用系统浏览器完成：
            </p>
            <ol className="wechatBannerList">
              <li>点微信右上角 <strong>「···」</strong></li>
              <li>选择 <strong>「在浏览器中打开」</strong> 或 <strong>「用 Safari 打开」</strong></li>
              <li>在 Safari / Chrome 里重新打开本链接，再点「启用声音」</li>
            </ol>
            <div className="wechatBannerActions">
              <button type="button" className="secondary" onClick={() => void copyCurrentPageUrl()}>
                {linkCopied ? '已复制链接' : '复制本页链接'}
              </button>
            </div>
          </div>
        ) : null}

        {step === 'login' ? (
          <>
            <h1>欢迎参与</h1>
            {loginAttempted &&
            !isWeChatInApp() &&
            (readInviteTokenFromUrl() == null || inviteGate === 'ok') &&
            (participantId.trim().length < 1 ||
              !consented ||
              !audioEnabled ||
              (audioEnabled && !volumeConfirmed)) ? (
              <div className="error" role="status">
                请补全下方标红项后再点「开始」。
              </div>
            ) : null}
            <p className="muted notice">
              <strong>研究说明：</strong>本页为<strong>研究二（实验任务）</strong>。若你尚未完成<strong>研究一（问卷调查）</strong>，请先完成问卷，再使用<strong>同一被试编号</strong>进入本页。
              <br />
              <strong>你需要准备：</strong>一台能出声的手机、平板或电脑；请尽量用 <strong>Safari / Chrome</strong> 打开本页（<strong>不要只用微信里直接打开</strong>，否则惩罚音可能无声）。若用电脑，反应时环节中可用<strong>空格键</strong>反应；手机和平板请用屏幕上出现的<strong>大按钮</strong>反应。
              <br />
              <strong>你要做的：</strong>填好下面的编号 → 勾选同意 → 点一次「启用声音」→ 点「开始」。编号请填<strong>通知或邮件里给你的那个</strong>（须与<strong>研究一问卷所用编号一致</strong>）；若你参加过本课题组别的线上任务，填<strong>当时同一个编号</strong>。若是点链接进来的，<strong>不要改地址栏里的内容</strong>。
            </p>
            {readInviteTokenFromUrl() ? (
              <p className="muted">
                下面会分几步走，按屏幕提示做就行。请不要和别人讨论题目细节。
              </p>
            ) : (
              <p className="muted">
                我们会记录你按键有多快，以及你在任务里填的一些设置。请自己完成，不要把题目内容告诉别人。
              </p>
            )}

            {inviteGate === 'loading' ? (
              <p className="muted">正在验证邀请链接…</p>
            ) : null}
            {inviteGate === 'error' && inviteError ? (
              <div className="error">邀请链接：{inviteError}</div>
            ) : null}

            <label className="field">
              <div className="label">编号</div>
              <input
                className={loginAttempted && participantId.trim().length < 1 ? 'fieldErrorInput' : undefined}
                value={participantId}
                onChange={(e) => setParticipantId(e.target.value)}
                placeholder="与通知中一致"
                autoComplete="off"
                readOnly={participantIdLocked}
              />
            </label>
            {participantIdLocked ? (
              <p className="muted">当前链接已绑定编号，无需修改。</p>
            ) : null}

            <label
              className={
                'checkbox' + (loginAttempted && !consented ? ' fieldErrorBox' : '')
              }
            >
              <input
                type="checkbox"
                checked={consented}
                onChange={(e) => setConsented(e.target.checked)}
              />
              <span>我已经看过知情同意书里的说明，愿意参加；中途随时可以退出。</span>
            </label>

            <div
              className={
                'audioBox' + (loginAttempted && !audioEnabled ? ' fieldErrorBox' : '')
              }
            >
              <div className="label">声音</div>
              <p className="muted">
                在这个小游戏里，<strong>谁输了，就可能要被罚听一段「沙沙」的白噪音</strong>——声音的<strong>响</strong>和<strong>持续多久</strong>，就是游戏规则里规定的<strong>惩罚手段</strong>（像游戏里扣血、罚时一样，只是这里用声音来表现）。
                请先把电脑音量调到你觉得<strong>舒服、不刺耳</strong>，再点下面按钮<strong>开声音</strong>（浏览器规定必须你亲手点一下才给播声音）。
              </p>
              <p className="muted">
                点「启用声音」后会先播放一声短提示音。若仍无声：请调高<strong>媒体音量</strong>；iPhone 请确认<strong>侧静音开关未拨到静音</strong>；尽量用
                <strong>Safari 或 Chrome</strong> 打开（<strong>微信内置浏览器</strong>常会导致实验页无声，请点右上角「…」用浏览器打开）。
              </p>
              <button className="secondary" onClick={() => void enableAudio()}>
                {audioEnabled ? '已启用声音' : '启用声音'}
              </button>
              {audioEnabled ? (
                <>
                  <p className="muted" style={{ marginTop: 12 }}>
                    <strong>关于系统音量：</strong>网页<strong>无法检测或替你调高</strong>手机/电脑的系统媒体音量。若把音量关到最低，惩罚会听不到，实验要求的效果无法实现。请务必先把<strong>媒体音量</strong>调到<strong>中等以上</strong>，再点下面「大声自检」确认能听见。
                  </p>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      syncUnlockAudioOnUserGesture()
                      playPreviewBeep(true)
                    }}
                  >
                    大声自检（再播一次较响的提示音）
                  </button>
                  <label
                    className={
                      'checkbox' +
                      (loginAttempted && audioEnabled && !volumeConfirmed ? ' fieldErrorBox' : '')
                    }
                    style={{ marginTop: 14 }}
                  >
                    <input
                      type="checkbox"
                      checked={volumeConfirmed}
                      onChange={(e) => setVolumeConfirmed(e.target.checked)}
                    />
                    <span>
                      我已将设备<strong>媒体音量</strong>调到中等以上，并能在当前环境下清楚听到上面的提示音；我明白若仍把音量关到最低导致听不到惩罚，属于未按要求完成实验。
                    </span>
                  </label>
                </>
              ) : null}
            </div>

            <button
              className="primary"
              disabled={
                busy ||
                isWeChatInApp() ||
                (readInviteTokenFromUrl() != null && inviteGate !== 'ok')
              }
              onClick={() => void tryStartSession()}
            >
              {busy ? '请稍候…' : isWeChatInApp() ? '请先用浏览器打开本页' : '开始'}
            </button>
          </>
        ) : null}

        {step === 'hook' ? (
          <>
            <h1>环节一：阅读</h1>
            <p className="muted">
              稍后会有一位<strong>游戏伙伴</strong>和你一起完成有奖小任务，下面用 <strong>游戏伙伴 B</strong> 来称呼他/她。
              <strong>现在请你先读下面这段故事</strong>，把它当成你和<strong>游戏伙伴 B</strong> 目前是怎么搭档的。请<strong>至少读满大约 1 分钟</strong>再点下面的按钮（页面会帮你计时）。
            </p>

            <div className="script">
              <p>
                请阅读以下情景并设身处地地想象：这学期你与游戏伙伴 B 组成小组完成一门核心课程的大作业。在过去的一个月里，
                你为了获得高绩点，主动承担了查阅文献、数据分析、撰写报告和 PPT 制作的所有工作，每天熬夜到两点，
                甚至为此推掉了很多娱乐活动。而游戏伙伴 B 借口“忙于实习”或“身体不适”，拒绝承担任何实质性工作，仅在汇报前一天象征性地修改了几个错别字。
              </p>
              <p>
                最终，老师给你们小组打了 90 分的高分。根据规则，你们两人获得了相同的绩点。更让你难以接受的是，游戏伙伴 B 因为这个高绩点，
                刚刚获得了你梦寐以求的“国家奖学金”，而你却因为微弱的差距落选了。
              </p>
              <p>
                你现在看着游戏伙伴 B，他/她正在群里炫耀自己的奖学金，并表示“全靠运气”。请花一分钟时间，充分体会你现在的感受。
              </p>
            </div>

            <label className="field">
              <div className="label">读完以后，你觉得现在有多生气？（1 = 几乎不生气，9 = 非常生气）</div>
              <input
                type="range"
                min={1}
                max={9}
                step={1}
                value={anger}
                onChange={(e) => setAnger(Number(e.target.value))}
              />
              <div className="rangeValue">你选的分数：{anger}</div>
            </label>

            <div className="hookContinueCard">
              <div className="hookContinueTimer" aria-live="polite">
                {hookCanContinue ? (
                  <div className="hookContinueReady">已满足最短阅读时间，可点击下方按钮继续。</div>
                ) : hookSecondsLeft != null ? (
                  <>
                    <div className="hookContinueTimerLabel">最短阅读计时剩余</div>
                    <div className="hookContinueTimerRow">
                      <span className="hookCountdownNum" aria-hidden>
                        {hookSecondsLeft}
                      </span>
                      <span className="hookContinueTimerUnit">秒</span>
                    </div>
                  </>
                ) : (
                  <div className="hookContinuePreparing">准备计时中…</div>
                )}
              </div>
              <button
                type="button"
                className="hookContinueBtn"
                disabled={busy || !hookCanContinue}
                onClick={() => void submitHook()}
              >
                {hookCanContinue ? (busy ? '提交中…' : '我读完了，继续') : '请再读一会儿（未满约 60 秒还不能继续）…'}
              </button>
            </div>
          </>
        ) : null}

        {step === 'crtt' ? (
          <>
            <h1>环节二：反应时</h1>
            <p className="muted">
              这一环节一共 <strong>25 轮</strong>，每轮你和 <strong>游戏伙伴 B</strong> 比<strong>谁反应更快</strong>。
            </p>
            {crttMode === 'practice' ? (
              <div className="feedback">
                现在先进行 <strong>{PRACTICE_PLAN.length} 轮练习</strong>，帮助你熟悉操作。练习数据不会进入正式分析。
              </div>
            ) : null}
            <p className="muted">
              <strong>每一轮怎么操作（按顺序）：</strong>
              <br />
              ① 先在下面用<strong>下拉框</strong>选两项：这是在给游戏伙伴 B 设定<strong>游戏惩罚</strong>——<strong>万一这轮你赢了、他输了</strong>，他要被罚听一段白噪音（像收音机没台时的沙沙声），<strong>多响、响多久</strong>就由这两项决定。
              <br />
              ② 点「开始本轮」。
              <br />
              ③ 等一会儿，屏幕上会出现大大的「<strong>GO</strong>」，<strong>一看到就马上反应</strong>：<strong>电脑可按空格键</strong>；<strong>手机或平板可点「我按了」或点 GO 区域任意位置</strong>。
              <br />
              ④ 谁按得快，谁赢这一轮。<strong>输了的人</strong>要按规则接受对方设好的<strong>声音惩罚</strong>（那段白噪音）；赢了这一轮就不用受罚。
            </p>
            <p className="muted">
              <strong>关于上面两项（都是在设定「惩罚」有多重）：</strong>第一个在 1～10 里选，表示惩罚声音有多响（数字越大越响；大致从轻到很响，约相当于 60～105 分贝那种概念，你这台设备实际多大以你听到的为准）。第二个在 0～5 秒里选（含 0.5 秒一档），表示这个惩罚声音要<strong>持续响多少秒</strong>。<strong>两项越大，这一轮里对方一旦输了，受到的惩罚就越重。</strong>
            </p>

            <div className="statusRow">
              <div className="pill">
                {crttMode === 'practice' ? '练习' : '正式'}第 {trialIndex + 1} 轮，共{' '}
                {getCurrentPlan()?.length ?? 0} 轮
              </div>
              {rtMs != null ? <div className="pill">你按键：{rtMs} 毫秒</div> : null}
            </div>

            {phase === 'practiceComplete' ? (
              <>
                {practicePassResult?.passed ? (
                  <>
                    <div className="feedback">
                      练习通过（有效反应 {practicePassResult.validCount}/{PRACTICE_PLAN.length} 轮）。你已经熟悉操作，点击下方按钮后将进入正式任务（共{' '}
                      {plan?.length ?? 25} 轮）。
                    </div>
                    <button className="primary" onClick={beginFormalCrtt}>
                      进入正式任务
                    </button>
                  </>
                ) : (
                  <>
                    <div className="error">
                      练习未通过：有效反应仅 {practicePassResult?.validCount ?? 0}/
                      {PRACTICE_PLAN.length} 轮。有效反应标准为 {PRACTICE_VALID_RT_MIN_MS}-
                      {PRACTICE_VALID_RT_MAX_MS} 毫秒，请重做练习后再进入正式任务。
                    </div>
                    <button className="primary" onClick={restartPractice}>
                      重新进行练习
                    </button>
                  </>
                )}
              </>
            ) : null}

            {phase === 'set' ? (
              <>
                <div className="grid2">
                  <label className="field">
                    <div className="label">游戏惩罚有多响（1 最轻，10 最响）</div>
                    <select
                      className="crttSelect"
                      value={intensity ?? ''}
                      onChange={(e) =>
                        setIntensity(e.target.value === '' ? null : Number(e.target.value))
                      }
                    >
                      <option value="">请选择</option>
                      {INTENSITY_OPTIONS.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <div className="label">惩罚声音持续几秒（0～5，含半秒一档）</div>
                    <select
                      className="crttSelect"
                      value={durationSec ?? ''}
                      onChange={(e) =>
                        setDurationSec(e.target.value === '' ? null : Number(e.target.value))
                      }
                    >
                      <option value="">请选择</option>
                      {DURATION_OPTIONS.map((d) => (
                        <option key={d} value={d}>
                          {d} 秒
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <button
                  className="primary"
                  onClick={beginReaction}
                  disabled={intensity == null || durationSec == null || !selectionReviewReady}
                >
                  {intensity != null && durationSec != null && !selectionReviewReady
                    ? '请先看清本轮选择…'
                    : '选好了，开始这一轮'}
                </button>
                {intensity == null || durationSec == null ? (
                  <p className="muted" style={{ marginTop: 10, textAlign: 'center' }}>
                    请先在上方两个下拉框中各选择一项（无默认响度/时长，须主动选择）。
                  </p>
                ) : null}
                {intensity != null && durationSec != null && !selectionReviewReady ? (
                  <p className="muted" style={{ marginTop: 10, textAlign: 'center' }}>
                    请确认本轮惩罚响度和时长后再开始。
                  </p>
                ) : null}
                {choiceWarning ? (
                  <div className="qualityWarning" role="alert">
                    {choiceWarning}
                  </div>
                ) : null}
              </>
            ) : null}

            {phase === 'wait' ? (
              <div className="bigCenter waitStack">
                <div className="ready">请等待，即将出现 GO</div>
                {waitRemainingSec != null && waitRemainingSec > 0 ? (
                  <div className="waitCountNum" aria-live="polite">
                    {waitRemainingSec}
                  </div>
                ) : (
                  <div className="waitCountNum waitCountDim">…</div>
                )}
                <p className="muted waitCountHint">数字为大约剩余整秒，归零后很快出现 GO。</p>
              </div>
            ) : null}

            {phase === 'go' ? (
              <div
                className="bigCenter goStack goStackInteractive"
                onPointerDown={() => commitGoReactionRef.current()}
              >
                <div className="go">GO</div>
                <p className="goHint muted">
                  电脑：按<strong>空格</strong>；手机/平板：点下面按钮或点本区域任意位置。
                </p>
                <button
                  type="button"
                  className="goTap"
                  onClick={() => commitGoReactionRef.current()}
                >
                  我按了
                </button>
              </div>
            ) : null}

            {phase === 'feedback' ? (
              <div className="feedback">
                {feedback ?? '…'}
                {crttMode === 'formal' && trialSaving ? (
                  <p className="muted">正在保存本轮数据，请不要刷新或关闭页面…</p>
                ) : null}
                {crttMode === 'formal' && pendingFormalTrial && !trialSaving && error ? (
                  <button type="button" className="primary" onClick={retryPendingFormalTrial}>
                    重新保存本轮数据
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}

        {step === 'manipulation' ? (
          <>
            <h1>最后一步：任务感受确认</h1>
            <p className="muted">
              请根据你刚才在反应时任务中的真实感受作答。1 = 非常不同意，7 = 非常同意。
            </p>
            {MANIPULATION_ITEMS.map((item) => (
              <label className="field" key={item.key}>
                <div className="label">{item.text}</div>
                <select
                  className={`crttSelect ${
                    manipulationAttempted && manipulationAnswers[item.key] == null
                      ? 'fieldErrorInput'
                      : ''
                  }`}
                  value={manipulationAnswers[item.key] ?? ''}
                  onChange={(e) =>
                    setManipulationAnswers((prev) => ({
                      ...prev,
                      [item.key]: e.target.value === '' ? null : Number(e.target.value),
                    }))
                  }
                >
                  <option value="">请选择</option>
                  <option value="1">1 非常不同意</option>
                  <option value="2">2 不同意</option>
                  <option value="3">3 有点不同意</option>
                  <option value="4">4 中立</option>
                  <option value="5">5 有点同意</option>
                  <option value="6">6 同意</option>
                  <option value="7">7 非常同意</option>
                </select>
              </label>
            ))}
            {error ? <div className="error">出错了：{error}</div> : null}
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void completeSession()}
            >
              {busy ? '提交中…' : '提交并完成研究二'}
            </button>
          </>
        ) : null}

        {step === 'done' ? (
          <>
            <h1>研究二已完成</h1>
            <p className="muted">谢谢你的参与，实验任务到这里就结束了，可以把网页关掉。</p>
          </>
        ) : null}
      </main>

      <footer className="footer">
        <span className="muted">研究二 · 实验任务</span>
      </footer>
    </div>
  )
}

export default App
