const { z } = require('zod')
const crypto = require('node:crypto')
const { customAlphabet } = require('nanoid')
const { stringify } = require('csv-stringify/sync')

const sessionNanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12)
const STUDY_VERSION = String(
  process.env.ONLINE_POINTS_STUDY_VERSION || 'q2_v4_0_reappraisal_15trial_test1_20260716'
).trim()
const TOTAL_TRIALS = 15
const INITIAL_TRIALS = 7
const INITIAL_POINTS = 200
const FORMAL_ENABLED = /^true$/i.test(String(process.env.ONLINE_POINTS_FORMAL_ENABLED || 'false'))
const DEFAULT_ROLE_RAW = String(process.env.ONLINE_POINTS_DEFAULT_DATA_ROLE || 'test').trim()
const DEFAULT_DATA_ROLE =
  DEFAULT_ROLE_RAW === 'pilot' || (DEFAULT_ROLE_RAW === 'formal' && FORMAL_ENABLED)
    ? DEFAULT_ROLE_RAW
    : 'test'
const CONDITIONS = [
  { code: 'freeride_natural', x: 'freeride', w: 'natural' },
  { code: 'freeride_reappraisal', x: 'freeride', w: 'reappraisal' },
  { code: 'fair_natural', x: 'fair', w: 'natural' },
  { code: 'fair_reappraisal', x: 'fair', w: 'reappraisal' },
]

const TRIAL_PLAN = [
  ['win', 0],
  ['win', 0],
  ['win', 0],
  ['loss', 0],
  ['loss', 0],
  ['win', 0],
  ['loss', 7],
  ['win', 1],
  ['loss', 6],
  ['loss', 5],
  ['loss', 4],
  ['win', 7],
  ['loss', 4],
  ['win', 2],
  ['win', 3],
].map((row, trialIndex) => ({
  trialIndex,
  phase: trialIndex < INITIAL_TRIALS ? 'initial' : 'mutual',
  outcome: row[0],
  opponentDeduction: row[1],
}))

const COMPREHENSION_CORRECT = {
  zeroMeaning: 'no_deduction',
  winnerTarget: 'partner',
  loserSource: 'partner_choice',
  choiceAffectsWin: 'no',
}

function addColumnIfMissing(db, table, column, definition) {
  const columns = db.prepare('pragma table_info(' + table + ')').all()
  if (!columns.some((row) => row.name === column)) {
    db.exec('alter table ' + table + ' add column ' + column + ' ' + definition)
  }
}

function ensureSchema(db) {
  db.exec(
    [
      'create table if not exists online_point_sessions (',
      '  session_id text primary key,',
      '  participant_id text not null,',
      '  study_version text not null,',
      "  data_role text not null default 'test',",
      "  reward_mode text not null default 'undecided',",
      '  initial_participant_points integer not null default 200,',
      '  initial_opponent_points integer not null default 200,',
      '  current_participant_points integer not null default 200,',
      '  current_opponent_points integer not null default 200,',
      '  user_agent text,',
      "  flow_stage text not null default 'setup',",
      '  setup_json text,',
      '  practice_json text,',
      '  condition_code text,',
      '  condition_x text,',
      '  condition_w text,',
      '  allocation_block integer,',
      '  assigned_at text,',
      '  comprehension_attempts integer not null default 0,',
      '  comprehension_first_pass integer,',
      '  comprehension_passed integer not null default 0,',
      '  comprehension_history_json text,',
      '  scenario_attempts integer not null default 0,',
      '  scenario_first_pass integer,',
      '  scenario_passed integer not null default 0,',
      '  scenario_history_json text,',
      '  scenario_duration_ms integer,',
      '  rd_state_json text,',
      '  rd_state_score real,',
      '  rd_duration_ms integer,',
      '  moral_disengagement_json text,',
      '  moral_disengagement_score real,',
      '  moral_disengagement_duration_ms integer,',
      '  regulation_text text,',
      '  regulation_acknowledged integer not null default 0,',
      '  regulation_submitted_at text,',
      '  regulation_duration_ms integer,',
      '  regulation_reminder_at text,',
      '  regulation_check_json text,',
      '  regulation_check_score real,',
      '  tab_hidden_count integer not null default 0,',
      '  interruption_level integer,',
      '  feedback_responsiveness integer,',
      '  believed_opponent_real integer,',
      '  belief_start_trial integer,',
      '  believed_choice_affected_opponent integer,',
      '  reward_consequence_importance integer,',
      '  serious_completion integer,',
      '  motive_retaliation integer,',
      '  motive_harm integer,',
      '  motive_win_belief integer,',
      '  motive_convenience integer,',
      '  motive_score_gap integer,',
      "  started_at text not null default (datetime('now')),",
      '  completed_at text,',
      '  unique(participant_id, study_version),',
      '  foreign key (participant_id) references participants(participant_id)',
      ');',
      'create table if not exists online_point_trials (',
      '  id integer primary key autoincrement,',
      '  session_id text not null,',
      '  trial_index integer not null,',
      '  phase text not null,',
      '  planned_outcome text not null,',
      '  opponent_deduction_planned integer not null,',
      '  participant_deduction_choice integer not null,',
      '  participant_rt_ms integer,',
      '  participant_points_before integer not null,',
      '  opponent_points_before integer not null,',
      '  deducted_from_participant integer not null,',
      '  deducted_from_opponent integer not null,',
      '  participant_points_after integer not null,',
      '  opponent_points_after integer not null,',
      '  opponent_attack_experienced integer not null default 0,',
      '  idempotency_key text not null,',
      "  settled_at text not null default (datetime('now')),",
      '  unique(session_id, trial_index),',
      '  unique(session_id, idempotency_key),',
      '  foreign key (session_id) references online_point_sessions(session_id)',
      ');',
      'create table if not exists online_point_trial_drafts (',
      '  id integer primary key autoincrement,',
      '  session_id text not null,',
      '  trial_index integer not null,',
      '  participant_deduction_choice integer not null,',
      '  idempotency_key text not null,',
      "  selected_at text not null default (datetime('now')),",
      '  settled_at text,',
      '  unique(session_id, trial_index),',
      '  unique(session_id, idempotency_key),',
      '  foreign key (session_id) references online_point_sessions(session_id)',
      ');',
    ].join('\n')
  )
  addColumnIfMissing(db, 'online_point_sessions', 'motive_retaliation', 'integer')
  addColumnIfMissing(db, 'online_point_sessions', 'motive_harm', 'integer')
  addColumnIfMissing(db, 'online_point_sessions', 'motive_win_belief', 'integer')
  addColumnIfMissing(db, 'online_point_sessions', 'motive_convenience', 'integer')
  addColumnIfMissing(db, 'online_point_sessions', 'motive_score_gap', 'integer')
  addColumnIfMissing(db, 'online_point_sessions', 'feedback_responsiveness', 'integer')
  addColumnIfMissing(db, 'online_point_sessions', 'flow_stage', "text not null default 'setup'")
  addColumnIfMissing(db, 'online_point_sessions', 'setup_json', 'text')
  addColumnIfMissing(db, 'online_point_sessions', 'practice_json', 'text')
  addColumnIfMissing(db, 'online_point_sessions', 'condition_code', 'text')
  addColumnIfMissing(db, 'online_point_sessions', 'condition_x', 'text')
  addColumnIfMissing(db, 'online_point_sessions', 'condition_w', 'text')
  addColumnIfMissing(db, 'online_point_sessions', 'allocation_block', 'integer')
  addColumnIfMissing(db, 'online_point_sessions', 'assigned_at', 'text')
  addColumnIfMissing(db, 'online_point_sessions', 'scenario_attempts', 'integer not null default 0')
  addColumnIfMissing(db, 'online_point_sessions', 'scenario_first_pass', 'integer')
  addColumnIfMissing(db, 'online_point_sessions', 'scenario_passed', 'integer not null default 0')
  addColumnIfMissing(db, 'online_point_sessions', 'scenario_history_json', 'text')
  addColumnIfMissing(db, 'online_point_sessions', 'scenario_duration_ms', 'integer')
  addColumnIfMissing(db, 'online_point_sessions', 'rd_state_json', 'text')
  addColumnIfMissing(db, 'online_point_sessions', 'rd_state_score', 'real')
  addColumnIfMissing(db, 'online_point_sessions', 'rd_duration_ms', 'integer')
  addColumnIfMissing(db, 'online_point_sessions', 'moral_disengagement_json', 'text')
  addColumnIfMissing(db, 'online_point_sessions', 'moral_disengagement_score', 'real')
  addColumnIfMissing(db, 'online_point_sessions', 'moral_disengagement_duration_ms', 'integer')
  addColumnIfMissing(db, 'online_point_sessions', 'regulation_text', 'text')
  addColumnIfMissing(db, 'online_point_sessions', 'regulation_acknowledged', 'integer not null default 0')
  addColumnIfMissing(db, 'online_point_sessions', 'regulation_submitted_at', 'text')
  addColumnIfMissing(db, 'online_point_sessions', 'regulation_duration_ms', 'integer')
  addColumnIfMissing(db, 'online_point_sessions', 'regulation_reminder_at', 'text')
  addColumnIfMissing(db, 'online_point_sessions', 'regulation_check_json', 'text')
  addColumnIfMissing(db, 'online_point_sessions', 'regulation_check_score', 'real')
  addColumnIfMissing(db, 'online_point_sessions', 'tab_hidden_count', 'integer not null default 0')
  addColumnIfMissing(db, 'online_point_sessions', 'interruption_level', 'integer')
}

function parseJson(value, fallback) {
  if (!value) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function mean(values) {
  return values.reduce((sum, value) => sum + Number(value), 0) / values.length
}

function requireStage(session, expected, res) {
  if (session.flow_stage !== expected) {
    res.status(409).json({
      error: 'flow_stage_not_ready',
      expectedStage: expected,
      currentStage: session.flow_stage,
    })
    return false
  }
  return true
}

function assignBalancedCondition(db, session, nowIso) {
  if (session.condition_code) return session
  const rows = db
    .prepare(
      'select condition_code, count(1) as n from online_point_sessions where study_version = ? and data_role = ? and condition_code is not null group by condition_code'
    )
    .all(session.study_version, session.data_role)
  const counts = new Map(rows.map((row) => [row.condition_code, Number(row.n)]))
  const minimum = Math.min(...CONDITIONS.map((condition) => counts.get(condition.code) || 0))
  const candidates = CONDITIONS.filter((condition) => (counts.get(condition.code) || 0) === minimum)
  const selected = candidates[crypto.randomInt(candidates.length)]
  const assignedCount = rows.reduce((sum, row) => sum + Number(row.n), 0)
  const block = Math.floor(assignedCount / CONDITIONS.length) + 1
  db.prepare(
    'update online_point_sessions set condition_code = ?, condition_x = ?, condition_w = ?, allocation_block = ?, assigned_at = ?, flow_stage = ? where session_id = ? and condition_code is null'
  ).run(selected.code, selected.x, selected.w, block, nowIso(), 'scenario', session.session_id)
  return db.prepare('select * from online_point_sessions where session_id = ?').get(session.session_id)
}

function sessionView(db, sessionId) {
  const session = db
    .prepare('select * from online_point_sessions where session_id = ?')
    .get(sessionId)
  if (!session) return null
  const trials = db
    .prepare(
      'select trial_index, phase, planned_outcome, opponent_deduction_planned, participant_deduction_choice, participant_rt_ms, participant_points_after, opponent_points_after, deducted_from_participant, deducted_from_opponent, opponent_attack_experienced, settled_at from online_point_trials where session_id = ? order by trial_index asc'
    )
    .all(sessionId)
  const pendingDraft = db
    .prepare(
      'select trial_index, participant_deduction_choice, idempotency_key, selected_at from online_point_trial_drafts where session_id = ? and settled_at is null order by trial_index desc limit 1'
    )
    .get(sessionId)
  return {
    sessionId: session.session_id,
    participantId: session.participant_id,
    studyVersion: session.study_version,
    dataRole: session.data_role,
    rewardMode: session.reward_mode,
    flowStage: session.completed_at ? 'done' : session.flow_stage,
    conditionCode: session.condition_code,
    conditionX: session.condition_x,
    conditionW: session.condition_w,
    allocationBlock: session.allocation_block,
    preflightPassed: Number(session.comprehension_passed) === 1,
    scenarioPassed: Number(session.scenario_passed) === 1,
    completed: Boolean(session.completed_at),
    nextTrialIndex: trials.length,
    totalTrials: TOTAL_TRIALS,
    participantPoints: session.current_participant_points,
    opponentPoints: session.current_opponent_points,
    setup: parseJson(session.setup_json, null),
    practice: parseJson(session.practice_json, null),
    rdState: parseJson(session.rd_state_json, null),
    moralDisengagement: parseJson(session.moral_disengagement_json, null),
    regulationText: session.regulation_text,
    regulationAcknowledged: Boolean(session.regulation_acknowledged),
    regulationReminderSeen: Boolean(session.regulation_reminder_at),
    tabHiddenCount: Number(session.tab_hidden_count || 0),
    pendingDraft: pendingDraft || null,
    trials,
  }
}

function computeDv(rows) {
  const avg = (items) =>
    items.length
      ? items.reduce((sum, row) => sum + Number(row.participant_deduction_choice), 0) /
        items.length
      : null
  const initial = rows.filter((row) => row.trial_index < INITIAL_TRIALS)
  const mutual = rows.filter((row) => row.trial_index >= INITIAL_TRIALS)
  const zeroCount = rows.filter((row) => Number(row.participant_deduction_choice) === 0).length
  const highCount = rows.filter((row) => Number(row.participant_deduction_choice) >= 7).length
  return {
    y_initial: avg(initial),
    y_initial_n: initial.length,
    y_mutual: avg(mutual),
    y_mutual_n: mutual.length,
    zero_choice_rate: rows.length ? zeroCount / rows.length : null,
    high_choice_rate: rows.length ? highCount / rows.length : null,
  }
}

function requireExport(req, res) {
  const token = typeof req.query.token === 'string' ? req.query.token : ''
  if (!process.env.EXPORT_TOKEN || token !== process.env.EXPORT_TOKEN) {
    res.status(401).send('unauthorized')
    return false
  }
  return true
}

function registerOnlinePointsRoutes({ app, db, nowIso }) {
  ensureSchema(db)

  app.get('/api/online-points/config', (_req, res) => {
    res.json({
      ok: true,
      studyVersion: STUDY_VERSION,
      dataRole: DEFAULT_DATA_ROLE,
      formalEnabled: FORMAL_ENABLED,
      totalTrials: TOTAL_TRIALS,
      initialTrials: INITIAL_TRIALS,
      initialPoints: INITIAL_POINTS,
      rewardMode: 'undecided',
      fullFlowTest: true,
      candidateMeasures: true,
    })
  })

  app.post('/api/online-points/session/start', (req, res) => {
    const schema = z.object({
      participantId: z.string().min(1).max(64),
      userAgent: z.string().max(512).optional(),
    })
    const parsed = schema.safeParse(req.body || {})
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

    const participantId = parsed.data.participantId.trim()
    const existing = db
      .prepare(
        'select session_id from online_point_sessions where participant_id = ? and study_version = ?'
      )
      .get(participantId, STUDY_VERSION)
    if (existing) {
      return res.json({ ok: true, resumed: true, state: sessionView(db, existing.session_id) })
    }

    const sessionId = sessionNanoid()
    db.transaction(() => {
      db.prepare(
        'insert into participants (participant_id, md, cr) values (?, null, null) on conflict(participant_id) do nothing'
      ).run(participantId)
      db.prepare(
        [
          'insert into online_point_sessions (',
          ' session_id, participant_id, study_version, data_role, reward_mode,',
          ' initial_participant_points, initial_opponent_points,',
          ' current_participant_points, current_opponent_points, user_agent, started_at',
          ') values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ].join('\n')
      ).run(
        sessionId,
        participantId,
        STUDY_VERSION,
        DEFAULT_DATA_ROLE,
        'undecided',
        INITIAL_POINTS,
        INITIAL_POINTS,
        INITIAL_POINTS,
        INITIAL_POINTS,
        parsed.data.userAgent || null,
        nowIso()
      )
    })()
    return res.json({ ok: true, resumed: false, state: sessionView(db, sessionId) })
  })

  app.get('/api/online-points/session/:sessionId', (req, res) => {
    const sessionId = String(req.params.sessionId || '')
    if (sessionId.length < 6 || sessionId.length > 32) {
      return res.status(400).json({ error: 'invalid_session_id' })
    }
    const state = sessionView(db, sessionId)
    if (!state) return res.status(404).json({ error: 'session_not_found' })
    return res.json({ ok: true, state })
  })

  app.post('/api/online-points/session/setup', (req, res) => {
    const deviceSchema = z.object({
      userAgent: z.string().max(512),
      screenWidth: z.number().int().min(1).max(20000),
      screenHeight: z.number().int().min(1).max(20000),
      viewportWidth: z.number().int().min(1).max(20000),
      viewportHeight: z.number().int().min(1).max(20000),
      touchPoints: z.number().int().min(0).max(100),
      language: z.string().max(64),
    })
    const schema = z.object({
      sessionId: z.string().min(6).max(32),
      age18Plus: z.boolean(),
      independentEnvironment: z.boolean(),
      stableNetwork: z.boolean(),
      pageReadable: z.boolean(),
      priorSimilarStudy: z.boolean(),
      device: deviceSchema.optional(),
    })
    const parsed = schema.safeParse(req.body || {})
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
    const session = db
      .prepare('select * from online_point_sessions where session_id = ?')
      .get(parsed.data.sessionId)
    if (!session) return res.status(404).json({ error: 'session_not_found' })
    if (!requireStage(session, 'setup', res)) return
    const eligible =
      parsed.data.age18Plus &&
      parsed.data.independentEnvironment &&
      parsed.data.stableNetwork &&
      parsed.data.pageReadable &&
      !parsed.data.priorSimilarStudy
    if (!eligible) return res.status(409).json({ error: 'setup_not_eligible_for_test' })
    db.prepare(
      'update online_point_sessions set setup_json = ?, flow_stage = ? where session_id = ?'
    ).run(JSON.stringify(parsed.data), 'practice', session.session_id)
    return res.json({ ok: true, state: sessionView(db, session.session_id) })
  })

  app.post('/api/online-points/session/visibility', (req, res) => {
    const schema = z.object({
      sessionId: z.string().min(6).max(32),
      tabHiddenCount: z.number().int().min(0).max(1000),
    })
    const parsed = schema.safeParse(req.body || {})
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
    const session = db
      .prepare('select * from online_point_sessions where session_id = ?')
      .get(parsed.data.sessionId)
    if (!session) return res.status(404).json({ error: 'session_not_found' })
    if (session.completed_at) return res.status(409).json({ error: 'session_already_completed' })
    db.prepare(
      'update online_point_sessions set tab_hidden_count = max(tab_hidden_count, ?) where session_id = ?'
    ).run(parsed.data.tabHiddenCount, session.session_id)
    return res.json({ ok: true, state: sessionView(db, session.session_id) })
  })

  app.post('/api/online-points/session/practice', (req, res) => {
    const practiceTrial = z.object({
      trialIndex: z.number().int().min(0).max(2),
      choice: z.number().int().min(0).max(10),
      outcome: z.enum(['win', 'loss']),
      deductedFromSelf: z.number().int().min(0).max(10),
      deductedFromPracticeOpponent: z.number().int().min(0).max(10),
    })
    const schema = z.object({
      sessionId: z.string().min(6).max(32),
      trials: z.array(practiceTrial).length(3),
    })
    const parsed = schema.safeParse(req.body || {})
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
    const session = db
      .prepare('select * from online_point_sessions where session_id = ?')
      .get(parsed.data.sessionId)
    if (!session) return res.status(404).json({ error: 'session_not_found' })
    if (!requireStage(session, 'practice', res)) return
    const indices = parsed.data.trials.map((trial) => trial.trialIndex)
    if (indices.join(',') !== '0,1,2') return res.status(400).json({ error: 'invalid_practice_order' })
    db.prepare(
      'update online_point_sessions set practice_json = ?, flow_stage = ? where session_id = ?'
    ).run(JSON.stringify(parsed.data.trials), 'rules', session.session_id)
    return res.json({ ok: true, state: sessionView(db, session.session_id) })
  })

  app.post('/api/online-points/session/preflight', (req, res) => {
    const answerSchema = z.object({
      zeroMeaning: z.enum(['no_deduction', 'minimum_deduction', 'skip_trial']),
      winnerTarget: z.enum(['self', 'partner', 'both']),
      loserSource: z.enum(['own_choice', 'partner_choice', 'random']),
      choiceAffectsWin: z.enum(['no', 'yes', 'only_high']),
    })
    const schema = z.object({
      sessionId: z.string().min(6).max(32),
      comprehensionHistory: z.array(answerSchema).min(1).max(5),
    })
    const parsed = schema.safeParse(req.body || {})
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
    const session = db
      .prepare('select * from online_point_sessions where session_id = ?')
      .get(parsed.data.sessionId)
    if (!session) return res.status(404).json({ error: 'session_not_found' })
    if (session.completed_at) return res.status(409).json({ error: 'session_already_completed' })
    if (!requireStage(session, 'rules', res)) return

    const isCorrect = (answer) =>
      answer.zeroMeaning === COMPREHENSION_CORRECT.zeroMeaning &&
      answer.winnerTarget === COMPREHENSION_CORRECT.winnerTarget &&
      answer.loserSource === COMPREHENSION_CORRECT.loserSource &&
      answer.choiceAffectsWin === COMPREHENSION_CORRECT.choiceAffectsWin
    const firstPass = isCorrect(parsed.data.comprehensionHistory[0])
    const passed = isCorrect(
      parsed.data.comprehensionHistory[parsed.data.comprehensionHistory.length - 1]
    )
    db.transaction(() => {
      db.prepare(
        [
          'update online_point_sessions set',
          ' comprehension_attempts = ?,',
          ' comprehension_first_pass = ?,',
          ' comprehension_passed = ?,',
          ' comprehension_history_json = ?',
          'where session_id = ?',
        ].join('\n')
      ).run(
        parsed.data.comprehensionHistory.length,
        firstPass ? 1 : 0,
        passed ? 1 : 0,
        JSON.stringify(parsed.data.comprehensionHistory),
        parsed.data.sessionId
      )
      if (passed) {
        const fresh = db
          .prepare('select * from online_point_sessions where session_id = ?')
          .get(parsed.data.sessionId)
        assignBalancedCondition(db, fresh, nowIso)
      }
    })()
    return res.json({
      ok: true,
      passed,
      firstPass,
      attempts: parsed.data.comprehensionHistory.length,
      state: sessionView(db, parsed.data.sessionId),
    })
  })

  app.post('/api/online-points/session/scenario', (req, res) => {
    const answerSchema = z.object({
      division: z.enum(['each_half', 'self_only', 'b_only']),
      contribution: z.enum(['self_most', 'both', 'b_most']),
      finalScore: z.enum(['both_90', 'self_90', 'b_90']),
    })
    const schema = z.object({
      sessionId: z.string().min(6).max(32),
      answerHistory: z.array(answerSchema).min(1).max(5),
      durationMs: z.number().int().min(0).max(3600000).optional(),
    })
    const parsed = schema.safeParse(req.body || {})
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
    const session = db
      .prepare('select * from online_point_sessions where session_id = ?')
      .get(parsed.data.sessionId)
    if (!session) return res.status(404).json({ error: 'session_not_found' })
    if (!requireStage(session, 'scenario', res)) return
    const correct = (answer) =>
      answer.division === 'each_half' &&
      answer.finalScore === 'both_90' &&
      (session.condition_x === 'freeride'
        ? answer.contribution === 'self_most'
        : answer.contribution === 'both')
    const firstPass = correct(parsed.data.answerHistory[0])
    const passed = correct(parsed.data.answerHistory[parsed.data.answerHistory.length - 1])
    db.prepare(
      'update online_point_sessions set scenario_attempts = ?, scenario_first_pass = ?, scenario_passed = ?, scenario_history_json = ?, scenario_duration_ms = ?, flow_stage = ? where session_id = ?'
    ).run(
      parsed.data.answerHistory.length,
      firstPass ? 1 : 0,
      passed ? 1 : 0,
      JSON.stringify(parsed.data.answerHistory),
      parsed.data.durationMs == null ? null : parsed.data.durationMs,
      passed ? 'rd' : 'scenario',
      session.session_id
    )
    return res.json({ ok: true, passed, firstPass, state: sessionView(db, session.session_id) })
  })

  app.post('/api/online-points/session/rd', (req, res) => {
    const schema = z.object({
      sessionId: z.string().min(6).max(32),
      answers: z.array(z.number().int().min(1).max(7)).length(4),
      durationMs: z.number().int().min(0).max(3600000).optional(),
    })
    const parsed = schema.safeParse(req.body || {})
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
    const session = db
      .prepare('select * from online_point_sessions where session_id = ?')
      .get(parsed.data.sessionId)
    if (!session) return res.status(404).json({ error: 'session_not_found' })
    if (!requireStage(session, 'rd', res)) return
    const score = mean(parsed.data.answers.slice(1))
    db.prepare(
      'update online_point_sessions set rd_state_json = ?, rd_state_score = ?, rd_duration_ms = ?, flow_stage = ? where session_id = ?'
    ).run(
      JSON.stringify(parsed.data.answers),
      score,
      parsed.data.durationMs == null ? null : parsed.data.durationMs,
      'm',
      session.session_id
    )
    return res.json({ ok: true, state: sessionView(db, session.session_id) })
  })

  app.post('/api/online-points/session/moral-disengagement', (req, res) => {
    const schema = z.object({
      sessionId: z.string().min(6).max(32),
      answers: z.record(z.string(), z.number().int().min(1).max(7)),
      durationMs: z.number().int().min(0).max(3600000).optional(),
    })
    const parsed = schema.safeParse(req.body || {})
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
    const session = db
      .prepare('select * from online_point_sessions where session_id = ?')
      .get(parsed.data.sessionId)
    if (!session) return res.status(404).json({ error: 'session_not_found' })
    if (!requireStage(session, 'm', res)) return
    const keys = Object.keys(parsed.data.answers).sort()
    if (keys.join(',') !== 'MD1,MD2,MD3,MD4') {
      return res.status(400).json({ error: 'invalid_moral_disengagement_items' })
    }
    const score = mean(keys.map((key) => parsed.data.answers[key]))
    db.prepare(
      'update online_point_sessions set moral_disengagement_json = ?, moral_disengagement_score = ?, moral_disengagement_duration_ms = ?, flow_stage = ? where session_id = ?'
    ).run(
      JSON.stringify(parsed.data.answers),
      score,
      parsed.data.durationMs == null ? null : parsed.data.durationMs,
      'regulation',
      session.session_id
    )
    return res.json({ ok: true, state: sessionView(db, session.session_id) })
  })

  app.post('/api/online-points/session/regulation', (req, res) => {
    const schema = z.object({
      sessionId: z.string().min(6).max(32),
      acknowledged: z.literal(true),
      durationMs: z.number().int().min(0).max(3600000).optional(),
    })
    const parsed = schema.safeParse(req.body || {})
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
    const session = db
      .prepare('select * from online_point_sessions where session_id = ?')
      .get(parsed.data.sessionId)
    if (!session) return res.status(404).json({ error: 'session_not_found' })
    if (!requireStage(session, 'regulation', res)) return
    db.prepare(
      'update online_point_sessions set regulation_text = null, regulation_acknowledged = 1, regulation_submitted_at = ?, regulation_duration_ms = ?, flow_stage = ? where session_id = ?'
    ).run(
      nowIso(),
      parsed.data.durationMs == null ? null : parsed.data.durationMs,
      'task',
      session.session_id
    )
    return res.json({ ok: true, state: sessionView(db, session.session_id) })
  })

  app.post('/api/online-points/session/regulation-reminder', (req, res) => {
    const schema = z.object({ sessionId: z.string().min(6).max(32) })
    const parsed = schema.safeParse(req.body || {})
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
    const session = db
      .prepare('select * from online_point_sessions where session_id = ?')
      .get(parsed.data.sessionId)
    if (!session) return res.status(404).json({ error: 'session_not_found' })
    if (!requireStage(session, 'task', res)) return
    const completedTrials = Number(
      db.prepare('select count(1) as c from online_point_trials where session_id = ?').get(session.session_id).c
    )
    if (completedTrials < INITIAL_TRIALS) {
      return res.status(409).json({
        error: 'regulation_reminder_not_due',
        requiredCompletedTrials: INITIAL_TRIALS,
        completedTrials,
      })
    }
    db.prepare(
      'update online_point_sessions set regulation_reminder_at = coalesce(regulation_reminder_at, ?) where session_id = ?'
    ).run(nowIso(), session.session_id)
    return res.json({ ok: true, state: sessionView(db, session.session_id) })
  })

  app.post('/api/online-points/trial/draft', (req, res) => {
    const schema = z.object({
      sessionId: z.string().min(6).max(32),
      trialIndex: z.number().int().min(0).max(TOTAL_TRIALS - 1),
      participantDeductionChoice: z.number().int().min(0).max(10),
      idempotencyKey: z.string().min(6).max(80),
    })
    const parsed = schema.safeParse(req.body || {})
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
    const input = parsed.data
    const session = db
      .prepare('select * from online_point_sessions where session_id = ?')
      .get(input.sessionId)
    if (!session) return res.status(404).json({ error: 'session_not_found' })
    if (!requireStage(session, 'task', res)) return
    const count = Number(
      db.prepare('select count(1) as c from online_point_trials where session_id = ?').get(input.sessionId).c
    )
    if (input.trialIndex !== count) {
      return res.status(409).json({ error: 'unexpected_trial_index', expectedTrialIndex: count })
    }
    if (count >= INITIAL_TRIALS && !session.regulation_reminder_at) {
      return res.status(409).json({ error: 'regulation_reminder_required' })
    }
    const existing = db
      .prepare('select * from online_point_trial_drafts where session_id = ? and trial_index = ?')
      .get(input.sessionId, input.trialIndex)
    if (existing) {
      if (
        Number(existing.participant_deduction_choice) !== input.participantDeductionChoice ||
        existing.idempotency_key !== input.idempotencyKey
      ) {
        return res.status(409).json({ error: 'draft_already_exists_with_different_payload' })
      }
      return res.json({ ok: true, idempotent: true, state: sessionView(db, input.sessionId) })
    }
    db.prepare(
      'insert into online_point_trial_drafts (session_id, trial_index, participant_deduction_choice, idempotency_key, selected_at) values (?, ?, ?, ?, ?)'
    ).run(
      input.sessionId,
      input.trialIndex,
      input.participantDeductionChoice,
      input.idempotencyKey,
      nowIso()
    )
    return res.json({ ok: true, idempotent: false, state: sessionView(db, input.sessionId) })
  })

  app.post('/api/online-points/trial/settle', (req, res) => {
    const schema = z.object({
      sessionId: z.string().min(6).max(32),
      trialIndex: z.number().int().min(0).max(TOTAL_TRIALS - 1),
      participantDeductionChoice: z.number().int().min(0).max(10),
      participantRtMs: z.number().int().min(50).max(10000).nullable().optional(),
      idempotencyKey: z.string().min(6).max(80),
    })
    const parsed = schema.safeParse(req.body || {})
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
    const input = parsed.data
    const session = db
      .prepare('select * from online_point_sessions where session_id = ?')
      .get(input.sessionId)
    if (!session) return res.status(404).json({ error: 'session_not_found' })
    const existing = db
      .prepare('select * from online_point_trials where session_id = ? and trial_index = ?')
      .get(input.sessionId, input.trialIndex)
    if (existing) {
      if (
        existing.idempotency_key !== input.idempotencyKey ||
        Number(existing.participant_deduction_choice) !== input.participantDeductionChoice
      ) {
        return res.status(409).json({ error: 'trial_already_settled_with_different_payload' })
      }
      return res.json({ ok: true, idempotent: true, trial: existing, state: sessionView(db, input.sessionId) })
    }
    if (session.completed_at) return res.status(409).json({ error: 'session_already_completed' })
    if (!requireStage(session, 'task', res)) return
    if (Number(session.comprehension_passed) !== 1) {
      return res.status(409).json({ error: 'preflight_not_passed' })
    }

    const count = Number(
      db
        .prepare('select count(1) as c from online_point_trials where session_id = ?')
        .get(input.sessionId).c
    )
    if (input.trialIndex !== count) {
      return res.status(409).json({ error: 'unexpected_trial_index', expectedTrialIndex: count })
    }

    const draft = db
      .prepare('select * from online_point_trial_drafts where session_id = ? and trial_index = ?')
      .get(input.sessionId, input.trialIndex)
    if (!draft) return res.status(409).json({ error: 'trial_draft_missing' })
    if (
      Number(draft.participant_deduction_choice) !== input.participantDeductionChoice ||
      draft.idempotency_key !== input.idempotencyKey
    ) {
      return res.status(409).json({ error: 'trial_draft_payload_mismatch' })
    }

    const plan = TRIAL_PLAN[input.trialIndex]
    const participantBefore = Number(session.current_participant_points)
    const opponentBefore = Number(session.current_opponent_points)
    const deductedFromParticipant =
      plan.outcome === 'loss' ? Math.min(participantBefore, Number(plan.opponentDeduction)) : 0
    const deductedFromOpponent =
      plan.outcome === 'win' ? Math.min(opponentBefore, input.participantDeductionChoice) : 0
    const participantAfter = participantBefore - deductedFromParticipant
    const opponentAfter = opponentBefore - deductedFromOpponent
    const attackExperienced =
      input.trialIndex >= INITIAL_TRIALS - 1 || deductedFromParticipant > 0 ? 1 : 0
    const settledAt = nowIso()

    try {
      db.transaction(() => {
        db.prepare(
          [
            'insert into online_point_trials (',
            ' session_id, trial_index, phase, planned_outcome, opponent_deduction_planned,',
            ' participant_deduction_choice, participant_rt_ms,',
            ' participant_points_before, opponent_points_before,',
            ' deducted_from_participant, deducted_from_opponent,',
            ' participant_points_after, opponent_points_after,',
            ' opponent_attack_experienced, idempotency_key, settled_at',
            ') values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          ].join('\n')
        ).run(
          input.sessionId,
          input.trialIndex,
          plan.phase,
          plan.outcome,
          plan.opponentDeduction,
          input.participantDeductionChoice,
          input.participantRtMs == null ? null : input.participantRtMs,
          participantBefore,
          opponentBefore,
          deductedFromParticipant,
          deductedFromOpponent,
          participantAfter,
          opponentAfter,
          attackExperienced,
          input.idempotencyKey,
          settledAt
        )
        db.prepare(
          'update online_point_sessions set current_participant_points = ?, current_opponent_points = ? where session_id = ?'
        ).run(participantAfter, opponentAfter, input.sessionId)
        db.prepare(
          'update online_point_trial_drafts set settled_at = ? where session_id = ? and trial_index = ?'
        ).run(settledAt, input.sessionId, input.trialIndex)
        if (input.trialIndex === TOTAL_TRIALS - 1) {
          db.prepare('update online_point_sessions set flow_stage = ? where session_id = ?').run(
            'checks',
            input.sessionId
          )
        }
      })()
    } catch (error) {
      if (/unique constraint/i.test(String(error && error.message))) {
        return res.status(409).json({ error: 'duplicate_trial_submission' })
      }
      throw error
    }

    const trial = db
      .prepare('select * from online_point_trials where session_id = ? and trial_index = ?')
      .get(input.sessionId, input.trialIndex)
    return res.json({ ok: true, idempotent: false, trial, state: sessionView(db, input.sessionId) })
  })

  app.post('/api/online-points/session/complete', (req, res) => {
    const schema = z.object({
      sessionId: z.string().min(6).max(32),
      feedbackResponsiveness: z.number().int().min(1).max(7),
      believedChoiceAffectedOpponent: z.number().int().min(1).max(7),
      rewardConsequenceImportance: z.number().int().min(1).max(7),
      seriousCompletion: z.number().int().min(1).max(7),
      interruptionLevel: z.number().int().min(1).max(7),
      motiveRetaliation: z.number().int().min(1).max(7),
      motiveHarm: z.number().int().min(1).max(7),
      motiveWinBelief: z.number().int().min(1).max(7),
      motiveConvenience: z.number().int().min(1).max(7),
      motiveScoreGap: z.number().int().min(1).max(7),
      regulationCheck: z.array(z.number().int().min(1).max(7)).length(3),
    })
    const parsed = schema.safeParse(req.body || {})
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
    const input = parsed.data
    const session = db
      .prepare('select * from online_point_sessions where session_id = ?')
      .get(input.sessionId)
    if (!session) return res.status(404).json({ error: 'session_not_found' })
    if (session.completed_at) {
      const completedRows = db
        .prepare('select * from online_point_trials where session_id = ? order by trial_index asc')
        .all(input.sessionId)
      return res.json({ ok: true, idempotent: true, dv: computeDv(completedRows), state: sessionView(db, input.sessionId) })
    }
    if (!requireStage(session, 'checks', res)) return
    const rows = db
      .prepare('select * from online_point_trials where session_id = ? order by trial_index asc')
      .all(input.sessionId)
    if (rows.length !== TOTAL_TRIALS) {
      return res.status(409).json({
        error: 'incomplete_trials',
        expectedTrials: TOTAL_TRIALS,
        savedTrials: rows.length,
      })
    }
    if (!session.completed_at) {
      db.prepare(
        [
          'update online_point_sessions set',
          ' feedback_responsiveness = ?,',
          ' believed_choice_affected_opponent = ?,',
          ' reward_consequence_importance = ?,',
          ' serious_completion = ?,',
          ' interruption_level = ?,',
          ' motive_retaliation = ?,',
          ' motive_harm = ?,',
          ' motive_win_belief = ?,',
          ' motive_convenience = ?,',
          ' motive_score_gap = ?,',
          ' regulation_check_json = ?,',
          ' regulation_check_score = ?,',
          ' completed_at = ?,',
          ' flow_stage = ?',
          'where session_id = ?',
        ].join('\n')
      ).run(
        input.feedbackResponsiveness,
        input.believedChoiceAffectedOpponent,
        input.rewardConsequenceImportance,
        input.seriousCompletion,
        input.interruptionLevel,
        input.motiveRetaliation,
        input.motiveHarm,
        input.motiveWinBelief,
        input.motiveConvenience,
        input.motiveScoreGap,
        JSON.stringify(input.regulationCheck),
        mean(input.regulationCheck),
        nowIso(),
        'done',
        input.sessionId
      )
    }
    return res.json({ ok: true, dv: computeDv(rows), state: sessionView(db, input.sessionId) })
  })

  app.get('/api/online-points/export.csv', (req, res) => {
    if (!requireExport(req, res)) return
    const sessions = db
      .prepare('select * from online_point_sessions order by started_at asc')
      .all()
    const trialStmt = db.prepare(
      'select * from online_point_trials where session_id = ? order by trial_index asc'
    )
    const draftStmt = db.prepare(
      'select trial_index, participant_deduction_choice, idempotency_key, selected_at, settled_at from online_point_trial_drafts where session_id = ? order by trial_index asc'
    )
    const rows = sessions.map((session) => {
      const trials = trialStmt.all(session.session_id)
      const drafts = draftStmt.all(session.session_id)
      return {
        participant_id: session.participant_id,
        session_id: session.session_id,
        study_version: session.study_version,
        data_role: session.data_role,
        reward_mode: session.reward_mode,
        flow_stage: session.flow_stage,
        condition_code: session.condition_code,
        condition_x: session.condition_x,
        condition_w: session.condition_w,
        allocation_block: session.allocation_block,
        assigned_at: session.assigned_at,
        started_at: session.started_at,
        completed_at: session.completed_at,
        setup_json: session.setup_json,
        practice_json: session.practice_json,
        comprehension_attempts: session.comprehension_attempts,
        comprehension_first_pass: session.comprehension_first_pass,
        comprehension_passed: session.comprehension_passed,
        scenario_attempts: session.scenario_attempts,
        scenario_first_pass: session.scenario_first_pass,
        scenario_passed: session.scenario_passed,
        scenario_history_json: session.scenario_history_json,
        scenario_duration_ms: session.scenario_duration_ms,
        rd_state_json: session.rd_state_json,
        rd_state_score: session.rd_state_score,
        rd_duration_ms: session.rd_duration_ms,
        moral_disengagement_json: session.moral_disengagement_json,
        moral_disengagement_score: session.moral_disengagement_score,
        moral_disengagement_duration_ms: session.moral_disengagement_duration_ms,
        regulation_text: session.regulation_text,
        regulation_acknowledged: session.regulation_acknowledged,
        regulation_submitted_at: session.regulation_submitted_at,
        regulation_duration_ms: session.regulation_duration_ms,
        regulation_reminder_at: session.regulation_reminder_at,
        regulation_check_json: session.regulation_check_json,
        regulation_check_score: session.regulation_check_score,
        tab_hidden_count: session.tab_hidden_count,
        interruption_level: session.interruption_level,
        participant_points_final: session.current_participant_points,
        opponent_points_final: session.current_opponent_points,
        feedback_responsiveness: session.feedback_responsiveness,
        believed_opponent_real: session.believed_opponent_real,
        belief_start_trial: session.belief_start_trial,
        believed_choice_affected_opponent: session.believed_choice_affected_opponent,
        reward_consequence_importance: session.reward_consequence_importance,
        serious_completion: session.serious_completion,
        motive_retaliation: session.motive_retaliation,
        motive_harm: session.motive_harm,
        motive_win_belief: session.motive_win_belief,
        motive_convenience: session.motive_convenience,
        motive_score_gap: session.motive_score_gap,
        ...computeDv(trials),
        trial_drafts_json: JSON.stringify(drafts),
        trials_json: JSON.stringify(trials),
      }
    })
    res.setHeader('content-type', 'text/csv; charset=utf-8')
    return res.send(stringify(rows, { header: true }))
  })

  app.get('/api/online-points/export_trials.csv', (req, res) => {
    if (!requireExport(req, res)) return
    const rows = db
      .prepare(
        [
          'select s.participant_id, s.study_version, s.data_role, s.reward_mode,',
          ' s.condition_code, s.condition_x, s.condition_w,',
          ' d.selected_at as choice_selected_at, d.settled_at as draft_settled_at,',
          ' (t.participant_points_before - t.opponent_points_before) as score_gap_before,',
          ' case when t.participant_points_before < t.opponent_points_before then 1 else 0 end as participant_behind_before,',
          ' (select p.participant_deduction_choice from online_point_trials p where p.session_id = t.session_id and p.trial_index = t.trial_index - 1) as prior_participant_choice,',
          ' (t.participant_deduction_choice - (select p.participant_deduction_choice from online_point_trials p where p.session_id = t.session_id and p.trial_index = t.trial_index - 1)) as choice_change_from_previous,',
          ' coalesce((select p.deducted_from_participant from online_point_trials p where p.session_id = t.session_id and p.trial_index = t.trial_index - 1), 0) as prior_deducted_from_participant,',
          ' t.* from online_point_trials t',
          ' join online_point_sessions s on s.session_id = t.session_id',
          ' left join online_point_trial_drafts d on d.session_id = t.session_id and d.trial_index = t.trial_index',
          ' order by s.started_at asc, t.trial_index asc',
        ].join('\n')
      )
      .all()
    res.setHeader('content-type', 'text/csv; charset=utf-8')
    return res.send(stringify(rows, { header: true }))
  })
}

module.exports = {
  registerOnlinePointsRoutes,
  TRIAL_PLAN,
  TOTAL_TRIALS,
  INITIAL_TRIALS,
}
