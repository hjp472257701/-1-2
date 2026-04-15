import { useEffect, useRef, useState } from 'react'
import './App.css'
import { apiFetch } from './api'

type CrttPlanItem = {
  trialIndex: number
  outcome: 'win' | 'loss'
  opponent: null | { intensity: number; durationMs: number }
}

type Step = 'login' | 'hook' | 'crtt' | 'done'

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

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [plan, setPlan] = useState<CrttPlanItem[] | null>(null)

  const [audioEnabled, setAudioEnabled] = useState(false)
  const audioRef = useRef<{
    ctx: AudioContext
    master: GainNode
  } | null>(null)

  const [hookStartIso, setHookStartIso] = useState<string | null>(null)
  const [anger, setAnger] = useState<number>(5)
  const [hookCanContinue, setHookCanContinue] = useState(false)

  const [trialIndex, setTrialIndex] = useState(0)
  const [crttMode, setCrttMode] = useState<CrttMode>('practice')
  const [intensity, setIntensity] = useState(5)
  const [durationSec, setDurationSec] = useState(2)
  const [phase, setPhase] = useState<'set' | 'wait' | 'go' | 'feedback' | 'practiceComplete'>(
    'set'
  )
  const [goAt, setGoAt] = useState<number | null>(null)
  const [rtMs, setRtMs] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [practiceRtList, setPracticeRtList] = useState<number[]>([])
  const [practicePassResult, setPracticePassResult] = useState<{
    passed: boolean
    validCount: number
  } | null>(null)
  const practiceRtListRef = useRef<number[]>([])

  const goReactionHandledRef = useRef(false)
  const commitGoReactionRef = useRef<() => void>(() => {})

  function intensityToGain(intensity01to10: number) {
    // Browser volume is not calibrated dB. We cap for safety.
    const x = Math.min(10, Math.max(1, intensity01to10))
    // Map 1..10 -> ~0.02..0.25 (soft to noticeable, not painfully loud)
    const min = 0.02
    const max = 0.25
    const t = (x - 1) / 9
    return min + t * (max - min)
  }

  async function enableAudio() {
    try {
      if (!audioRef.current) {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
        const master = ctx.createGain()
        master.gain.value = 0.15
        master.connect(ctx.destination)
        audioRef.current = { ctx, master }
      }
      if (audioRef.current.ctx.state !== 'running') {
        await audioRef.current.ctx.resume()
      }
      setAudioEnabled(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'audio_enable_failed')
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
    const target = Math.min(0.35, Math.max(0, gain))
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(target, t0 + attack)
    g.gain.setValueAtTime(target, t0 + Math.max(attack, dur / 1000 - release))
    g.gain.linearRampToValueAtTime(0, t0 + dur / 1000)

    source.start()
    source.stop(t0 + dur / 1000 + 0.01)
  }

  useEffect(() => {
    document.title = '研究二 · 实验任务'
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

  async function startSession() {
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
      setStep('hook')
      const t = new Date().toISOString()
      setHookStartIso(t)
      setHookCanContinue(false)
      window.setTimeout(() => setHookCanContinue(true), 60_000)
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

  async function submitTrial(payload: {
    trialIndex: number
    outcome: 'win' | 'loss'
    participantRtMs: number | null
    participantIntensity: number
    participantDurationMs: number
    opponentIntensity: number | null
    opponentDurationMs: number | null
  }) {
    if (!sessionId) return
    const r = await apiFetch('/api/trial', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, ...payload }),
    })
    if (!r.ok) throw new Error(`trial_failed_${r.status}`)
  }

  async function completeSession() {
    if (!sessionId) return
    setBusy(true)
    setError(null)
    try {
      const r = await apiFetch('/api/session/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
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
    setIntensity(5)
    setDurationSec(2)
    setPhase('set')
    setFeedback(null)
    setGoAt(null)
    setRtMs(null)
  }

  function restartPractice() {
    setCrttMode('practice')
    setTrialIndex(0)
    setIntensity(5)
    setDurationSec(2)
    setPhase('set')
    setFeedback(null)
    setGoAt(null)
    setRtMs(null)
    setPracticeRtList([])
    practiceRtListRef.current = []
    setPracticePassResult(null)
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
        return
      }
      void completeSession()
      return
    }
    setTrialIndex(nextIndex)
    setIntensity(5)
    setDurationSec(2)
    setPhase('set')
    setFeedback(null)
    setGoAt(null)
    setRtMs(null)
  }

  function beginReaction() {
    goReactionHandledRef.current = false
    setPhase('wait')
    setFeedback(null)
    setRtMs(null)
    setGoAt(null)
    const delay = 700 + Math.floor(Math.random() * 900) // 700-1600ms
    window.setTimeout(() => {
      goReactionHandledRef.current = false
      setGoAt(performance.now())
      setPhase('go')
    }, delay)
  }

  commitGoReactionRef.current = () => {
    if (phase !== 'go' || goAt == null) return
    if (goReactionHandledRef.current) return
    const currentPlan = getCurrentPlan()
    const item = currentPlan?.[trialIndex] ?? null
    if (!item) return
    goReactionHandledRef.current = true

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
        ? `这轮你慢了一点，算你输。按游戏规则，你要接受一段声音惩罚：白噪音约 ${oppIntensity} 档响度、${Math.round(
            (oppDur ?? 0) / 100
          ) / 10} 秒（游戏伙伴 B 在开始前设好的）。`
        : '这轮你更快，算你赢。这一轮不用接受声音惩罚。'
    const msg = crttMode === 'practice' ? `[练习轮次，不计入正式数据] ${baseMsg}` : baseMsg
    setFeedback(msg)

    if (item.outcome === 'loss' && audioEnabled && oppIntensity != null && oppDur != null) {
      playWhiteNoise({ gain: intensityToGain(oppIntensity), durationMs: oppDur })
    }

    if (crttMode === 'formal') {
      void submitTrial({
        trialIndex,
        outcome: item.outcome,
        participantRtMs: rt,
        participantIntensity: intensity,
        participantDurationMs: pDurMs,
        opponentIntensity: oppIntensity,
        opponentDurationMs: oppDur,
      }).catch((e) => setError(e instanceof Error ? e.message : 'trial_failed'))
    }

    window.setTimeout(() => finishAndAdvance(trialIndex + 1), 1200)
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

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">研究二 · 实验任务</div>
        <div className="meta" />
      </header>

      <main className="card">
        {error ? <div className="error">出错了：{error}</div> : null}

        {step === 'login' ? (
          <>
            <h1>欢迎参与</h1>
            <p className="muted notice">
              <strong>研究说明：</strong>本页为<strong>研究二（实验任务）</strong>。若你尚未完成<strong>研究一（问卷调查）</strong>，请先完成问卷，再使用<strong>同一被试编号</strong>进入本页。
              <br />
              <strong>你需要准备：</strong>一台能出声的手机、平板或电脑；用 <strong>Chrome</strong>、<strong>Safari（iPhone）</strong> 或 <strong>Edge</strong> 打开本页。若用电脑，反应时环节中可用<strong>空格键</strong>反应；手机和平板请用屏幕上出现的<strong>大按钮</strong>反应。
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

            <label className="checkbox">
              <input
                type="checkbox"
                checked={consented}
                onChange={(e) => setConsented(e.target.checked)}
              />
              <span>我已经看过知情同意书里的说明，愿意参加；中途随时可以退出。</span>
            </label>

            <div className="audioBox">
              <div className="label">声音</div>
              <p className="muted">
                在这个小游戏里，<strong>谁输了，就可能要被罚听一段「沙沙」的白噪音</strong>——声音的<strong>响</strong>和<strong>持续多久</strong>，就是游戏规则里规定的<strong>惩罚手段</strong>（像游戏里扣血、罚时一样，只是这里用声音来表现）。
                请先把电脑音量调到你觉得<strong>舒服、不刺耳</strong>，再点下面按钮<strong>开声音</strong>（浏览器规定必须你亲手点一下才给播声音）。
              </p>
              <button className="secondary" onClick={() => void enableAudio()}>
                {audioEnabled ? '已启用声音' : '启用声音'}
              </button>
            </div>

            <button
              className="primary"
              disabled={
                busy ||
                !consented ||
                participantId.trim().length < 1 ||
                !audioEnabled ||
                (readInviteTokenFromUrl() != null && inviteGate !== 'ok')
              }
              onClick={() => void startSession()}
            >
              {busy ? '请稍候…' : '开始'}
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

            <button
              className="primary"
              disabled={busy || !hookCanContinue}
              onClick={() => void submitHook()}
            >
              {hookCanContinue ? (busy ? '提交中…' : '我读完了，继续') : '请再读一会儿（未满约 60 秒还不能继续）…'}
            </button>
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
                      value={intensity}
                      onChange={(e) => setIntensity(Number(e.target.value))}
                    >
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
                      value={durationSec}
                      onChange={(e) => setDurationSec(Number(e.target.value))}
                    >
                      {DURATION_OPTIONS.map((d) => (
                        <option key={d} value={d}>
                          {d} 秒
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <button className="primary" onClick={beginReaction}>
                  选好了，开始这一轮
                </button>
              </>
            ) : null}

            {phase === 'wait' ? (
              <div className="bigCenter">
                <div className="ready">请等待…</div>
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
              <div className="feedback">{feedback ?? '…'}</div>
            ) : null}
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
