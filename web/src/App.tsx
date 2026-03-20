import { useEffect, useRef, useState } from 'react'
import './App.css'
import { apiFetch } from './api'

type CrttPlanItem = {
  trialIndex: number
  outcome: 'win' | 'loss'
  opponent: null | { intensity: number; durationMs: number }
}

type Step = 'login' | 'hook' | 'crtt' | 'done'

function App() {
  const [step, setStep] = useState<Step>('login')
  const [participantId, setParticipantId] = useState(() => {
    const url = new URL(window.location.href)
    return url.searchParams.get('pid') ?? ''
  })
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
  const [hookEndIso, setHookEndIso] = useState<string | null>(null)
  const [anger, setAnger] = useState<number>(5)
  const [hookCanContinue, setHookCanContinue] = useState(false)

  const [trialIndex, setTrialIndex] = useState(0)
  const [intensity, setIntensity] = useState(5)
  const [durationSec, setDurationSec] = useState(2)
  const [phase, setPhase] = useState<'set' | 'wait' | 'go' | 'feedback'>('set')
  const [goAt, setGoAt] = useState<number | null>(null)
  const [rtMs, setRtMs] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

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

  async function startSession() {
    setBusy(true)
    setError(null)
    try {
      const r = await apiFetch('/api/session/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          participantId: participantId.trim(),
          userAgent: navigator.userAgent,
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
      setHookEndIso(end)
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
      setTrialIndex(0)
      setPhase('set')
      setFeedback(null)
      setGoAt(null)
      setRtMs(null)
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

  function currentPlanItem() {
    if (!plan) return null
    return plan[trialIndex] ?? null
  }

  function beginReaction() {
    setPhase('wait')
    setFeedback(null)
    setRtMs(null)
    setGoAt(null)
    const delay = 700 + Math.floor(Math.random() * 900) // 700-1600ms
    window.setTimeout(() => {
      setGoAt(performance.now())
      setPhase('go')
    }, delay)
  }

  function finishAndAdvance(nextIndex: number) {
    if (!plan) return
    if (nextIndex >= plan.length) {
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

  useEffect(() => {
    if (step !== 'crtt') return
    if (phase !== 'go') return
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.code !== 'Space') return
      ev.preventDefault()
      if (goAt == null) return
      const rt = Math.max(0, Math.round(performance.now() - goAt))
      setRtMs(rt)
      setPhase('feedback')

      const item = currentPlanItem()
      if (!item) return

      const pDurMs = Math.round(durationSec * 1000)
      const opp = item.opponent
      const oppIntensity = opp ? opp.intensity : null
      const oppDur = opp ? opp.durationMs : null

      const msg =
        item.outcome === 'loss'
          ? `你输了。本轮你将收到对手设置的噪音（强度 ${oppIntensity}，时长 ${Math.round(
              (oppDur ?? 0) / 100
            ) / 10}s）。`
          : '你赢了。本轮你不会收到噪音。'
      setFeedback(msg)

      // Real stimulus: play opponent noise only when participant loses.
      if (item.outcome === 'loss' && audioEnabled && oppIntensity != null && oppDur != null) {
        playWhiteNoise({ gain: intensityToGain(oppIntensity), durationMs: oppDur })
      }

      void submitTrial({
        trialIndex,
        outcome: item.outcome,
        participantRtMs: rt,
        participantIntensity: intensity,
        participantDurationMs: pDurMs,
        opponentIntensity: oppIntensity,
        opponentDurationMs: oppDur,
      }).catch((e) => setError(e instanceof Error ? e.message : 'trial_failed'))

      window.setTimeout(() => finishAndAdvance(trialIndex + 1), 1200)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [step, phase, goAt, durationSec, intensity, trialIndex, plan])

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">CRTT 在线实验</div>
        <div className="meta">
          {sessionId ? <span className="pill">session: {sessionId}</span> : null}
        </div>
      </header>

      <main className="card">
        {error ? <div className="error">错误：{error}</div> : null}

        {step === 'login' ? (
          <>
            <h1>参与实验</h1>
            <p className="muted">
              请输入你的被试 ID（与研究一一致）。本实验会记录你在任务中的按键反应时，以及你对对手设置的噪音惩罚强度与时长。
            </p>

            <label className="field">
              <div className="label">被试 ID</div>
              <input
                value={participantId}
                onChange={(e) => setParticipantId(e.target.value)}
                placeholder="例如：S0123"
                autoComplete="off"
              />
            </label>

            <label className="checkbox">
              <input
                type="checkbox"
                checked={consented}
                onChange={(e) => setConsented(e.target.checked)}
              />
              <span>我已阅读并同意参与本研究（可随时退出）。</span>
            </label>

            <div className="audioBox">
              <div className="label">声音刺激</div>
              <p className="muted">
                任务中可能出现短暂白噪音作为惩罚刺激。请将系统音量调至舒适水平，然后点击一次“启用声音”（浏览器需要用户手势授权）。
              </p>
              <button className="secondary" onClick={() => void enableAudio()}>
                {audioEnabled ? '已启用声音' : '启用声音'}
              </button>
            </div>

            <button
              className="primary"
              disabled={busy || !consented || participantId.trim().length < 1 || !audioEnabled}
              onClick={() => void startSession()}
            >
              {busy ? '启动中…' : '开始'}
            </button>
          </>
        ) : null}

        {step === 'hook' ? (
          <>
            <h1>情景阅读</h1>
            <p className="muted">
              请仔细阅读并设身处地想象下面情景。为保证操纵有效性，阅读至少 1 分钟后才能继续。
            </p>

            <div className="script">
              <p>
                请阅读以下情景并设身处地地想象：这学期你与 Partner B 组成小组完成一门核心课程的大作业。在过去的一个月里，
                你为了获得高绩点，主动承担了查阅文献、数据分析、撰写报告和 PPT 制作的所有工作（高投入），每天熬夜到两点，
                甚至为此推掉了很多娱乐活动。而 Partner B 借口“忙于实习”或“身体不适”，拒绝承担任何实质性工作，仅在汇报前一天象征性地修改了几个错别字（低投入）。
              </p>
              <p>
                最终，老师给你们小组打了 90 分的高分。根据规则，你们两人获得了相同的绩点。更让你难以接受的是，Partner B 因为这个高绩点，
                刚刚获得了你梦寐以求的“国家奖学金”，而你却因为微弱的差距落选了（同酬且资源被剥夺）。你现在看着 Partner B，他/她正在群里炫耀自己的奖学金，
                并表示“全靠运气”。请花一分钟时间，充分体会你现在的感受。
              </p>
            </div>

            <label className="field">
              <div className="label">此刻你有多愤怒？（1-9）</div>
              <input
                type="range"
                min={1}
                max={9}
                step={1}
                value={anger}
                onChange={(e) => setAnger(Number(e.target.value))}
              />
              <div className="rangeValue">{anger}</div>
            </label>

            <button
              className="primary"
              disabled={busy || !hookCanContinue}
              onClick={() => void submitHook()}
            >
              {hookCanContinue ? (busy ? '提交中…' : '进入任务') : '请继续阅读（计时 60 秒）…'}
            </button>
          </>
        ) : null}

        {step === 'crtt' ? (
          <>
            <h1>竞争反应时任务（CRTT）</h1>
            <p className="muted">
              共 25 轮。每轮开始前，请为对手设置：噪音强度（1-10）和持续时间（0-5 秒）。设置后点击“开始本轮”，随后看到“GO”请尽快按空格键。
            </p>

            <div className="statusRow">
              <div className="pill">轮次：{trialIndex + 1} / {plan?.length ?? 25}</div>
              {rtMs != null ? <div className="pill">反应时：{rtMs} ms</div> : null}
            </div>

            {phase === 'set' ? (
              <>
                <div className="grid2">
                  <label className="field">
                    <div className="label">你设置的噪音强度（1-10）</div>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={intensity}
                      onChange={(e) => setIntensity(Number(e.target.value))}
                    />
                  </label>
                  <label className="field">
                    <div className="label">你设置的噪音时长（秒，0-5）</div>
                    <input
                      type="number"
                      min={0}
                      max={5}
                      step={0.5}
                      value={durationSec}
                      onChange={(e) => setDurationSec(Number(e.target.value))}
                    />
                  </label>
                </div>
                <button className="primary" onClick={beginReaction}>
                  开始本轮
                </button>
              </>
            ) : null}

            {phase === 'wait' ? (
              <div className="bigCenter">
                <div className="ready">Ready…</div>
              </div>
            ) : null}

            {phase === 'go' ? (
              <div className="bigCenter">
                <div className="go">GO（按空格）</div>
              </div>
            ) : null}

            {phase === 'feedback' ? (
              <div className="feedback">{feedback ?? '…'}</div>
            ) : null}
          </>
        ) : null}

        {step === 'done' ? (
          <>
            <h1>完成</h1>
            <p className="muted">感谢参与。你现在可以关闭页面。</p>
          </>
        ) : null}
      </main>

      <footer className="footer">
        <span className="muted">研究二：机制验证（实验室情景实验 - 线上实现）</span>
      </footer>
    </div>
  )
}

export default App
