const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const port = 34120
const base = 'http://127.0.0.1:' + port
const dbPath = path.join(os.tmpdir(), 'q2-online-points-test-' + process.pid + '.sqlite3')
const exportToken = 'online-points-test-token'

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server_start_timeout')), 10000)
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('CRTT server listening')) {
        clearTimeout(timeout)
        resolve()
      }
    })
    child.stderr.on('data', (chunk) => process.stderr.write(chunk))
    child.on('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error('server_exited_' + code))
    })
  })
}

async function jsonRequest(url, options) {
  const response = await fetch(base + url, options)
  const body = await response.json().catch(() => ({}))
  return { response, body }
}

async function post(url, body) {
  return jsonRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function scenarioAnswerFor(conditionX) {
  return conditionX === 'freeride'
    ? { division: 'each_half', contribution: 'self_most', finalScore: 'both_90' }
    : { division: 'each_half', contribution: 'both', finalScore: 'both_90' }
}

async function main() {
  const child = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      DB_PATH: dbPath,
      PORT: String(port),
      EXPORT_TOKEN: exportToken,
      ONLINE_POINTS_STUDY_VERSION: 'q2_v4_0_reappraisal_15trial_integration',
      ONLINE_POINTS_DEFAULT_DATA_ROLE: 'test',
      ONLINE_POINTS_FORMAL_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    await waitForServer(child)

    const config = await jsonRequest('/api/online-points/config')
    assert.equal(config.response.status, 200)
    assert.equal(config.body.totalTrials, 15)
    assert.equal(config.body.initialTrials, 7)
    assert.equal(config.body.formalEnabled, false)

    const started = await post('/api/online-points/session/start', {
      participantId: 'online-test-001',
      userAgent: 'integration-test',
    })
    assert.equal(started.response.status, 200)
    assert.equal(started.body.state.dataRole, 'test')
    assert.equal(started.body.state.participantPoints, 200)
    assert.equal(started.body.state.opponentPoints, 200)
    assert.equal(started.body.state.flowStage, 'setup')
    const sessionId = started.body.state.sessionId

    const visibility = await post('/api/online-points/session/visibility', {
      sessionId,
      tabHiddenCount: 1,
    })
    assert.equal(visibility.response.status, 200)
    assert.equal(visibility.body.state.tabHiddenCount, 1)
    const repeatedVisibility = await post('/api/online-points/session/visibility', {
      sessionId,
      tabHiddenCount: 1,
    })
    assert.equal(repeatedVisibility.response.status, 200)
    assert.equal(repeatedVisibility.body.state.tabHiddenCount, 1)

    const earlyDraft = await post('/api/online-points/trial/draft', {
      sessionId,
      trialIndex: 0,
      participantDeductionChoice: 10,
      idempotencyKey: 'trial-0-first',
    })
    assert.equal(earlyDraft.response.status, 409)
    assert.equal(earlyDraft.body.error, 'flow_stage_not_ready')

    const setup = await post('/api/online-points/session/setup', {
      sessionId,
      age18Plus: true,
      independentEnvironment: true,
      stableNetwork: true,
      pageReadable: true,
      priorSimilarStudy: false,
    })
    assert.equal(setup.response.status, 200)
    assert.equal(setup.body.state.flowStage, 'practice')

    const practice = await post('/api/online-points/session/practice', {
      sessionId,
      trials: [
        { trialIndex: 0, choice: 0, outcome: 'win', deductedFromSelf: 0, deductedFromPracticeOpponent: 0 },
        { trialIndex: 1, choice: 4, outcome: 'loss', deductedFromSelf: 2, deductedFromPracticeOpponent: 0 },
        { trialIndex: 2, choice: 6, outcome: 'win', deductedFromSelf: 0, deductedFromPracticeOpponent: 6 },
      ],
    })
    assert.equal(practice.response.status, 200)
    assert.equal(practice.body.state.flowStage, 'rules')

    const badPreflight = await post('/api/online-points/session/preflight', {
      sessionId,
      comprehensionHistory: [
        {
          zeroMeaning: 'minimum_deduction',
          winnerTarget: 'self',
          loserSource: 'own_choice',
          choiceAffectsWin: 'yes',
        },
      ],
    })
    assert.equal(badPreflight.response.status, 200)
    assert.equal(badPreflight.body.passed, false)

    const goodPreflight = await post('/api/online-points/session/preflight', {
      sessionId,
      comprehensionHistory: [
        {
          zeroMeaning: 'minimum_deduction',
          winnerTarget: 'self',
          loserSource: 'own_choice',
          choiceAffectsWin: 'yes',
        },
        {
          zeroMeaning: 'no_deduction',
          winnerTarget: 'partner',
          loserSource: 'partner_choice',
          choiceAffectsWin: 'no',
        },
      ],
    })
    assert.equal(goodPreflight.response.status, 200)
    assert.equal(goodPreflight.body.passed, true)
    assert.equal(goodPreflight.body.firstPass, false)
    assert.equal(goodPreflight.body.state.flowStage, 'scenario')
    assert.ok(goodPreflight.body.state.conditionCode)
    assert.ok(goodPreflight.body.state.conditionX)
    assert.ok(goodPreflight.body.state.conditionW)

    const resumedAfterAssignment = await post('/api/online-points/session/start', {
      participantId: 'online-test-001',
      userAgent: 'integration-test-resume',
    })
    assert.equal(resumedAfterAssignment.response.status, 200)
    assert.equal(resumedAfterAssignment.body.resumed, true)
    assert.equal(resumedAfterAssignment.body.state.sessionId, sessionId)
    assert.equal(
      resumedAfterAssignment.body.state.conditionCode,
      goodPreflight.body.state.conditionCode
    )

    const firstBlockAssignments = [goodPreflight.body.state.conditionCode]
    const assignedSessions = [
      {
        sessionId,
        conditionX: goodPreflight.body.state.conditionX,
      },
    ]
    assert.equal(goodPreflight.body.state.allocationBlock, 1)
    for (let participantNumber = 2; participantNumber <= 4; participantNumber += 1) {
      const balancingSession = await post('/api/online-points/session/start', {
        participantId: 'online-balance-00' + participantNumber,
        userAgent: 'integration-test',
      })
      assert.equal(balancingSession.response.status, 200)
      const balancingSessionId = balancingSession.body.state.sessionId
      const balancingSetup = await post('/api/online-points/session/setup', {
        sessionId: balancingSessionId,
        age18Plus: true,
        independentEnvironment: true,
        stableNetwork: true,
        pageReadable: true,
        priorSimilarStudy: false,
      })
      assert.equal(balancingSetup.response.status, 200)
      const balancingPractice = await post('/api/online-points/session/practice', {
        sessionId: balancingSessionId,
        trials: [
          { trialIndex: 0, choice: 0, outcome: 'win', deductedFromSelf: 0, deductedFromPracticeOpponent: 0 },
          { trialIndex: 1, choice: 4, outcome: 'loss', deductedFromSelf: 2, deductedFromPracticeOpponent: 0 },
          { trialIndex: 2, choice: 6, outcome: 'win', deductedFromSelf: 0, deductedFromPracticeOpponent: 6 },
        ],
      })
      assert.equal(balancingPractice.response.status, 200)
      const balancingPreflight = await post('/api/online-points/session/preflight', {
        sessionId: balancingSessionId,
        comprehensionHistory: [
          {
            zeroMeaning: 'no_deduction',
            winnerTarget: 'partner',
            loserSource: 'partner_choice',
            choiceAffectsWin: 'no',
          },
        ],
      })
      assert.equal(balancingPreflight.response.status, 200)
      assert.equal(balancingPreflight.body.passed, true)
      assert.equal(balancingPreflight.body.state.allocationBlock, 1)
      firstBlockAssignments.push(balancingPreflight.body.state.conditionCode)
      assignedSessions.push({
        sessionId: balancingSessionId,
        conditionX: balancingPreflight.body.state.conditionX,
      })
    }
    assert.equal(new Set(firstBlockAssignments).size, 4)

    for (const assigned of assignedSessions.slice(1)) {
      const branchScenario = await post('/api/online-points/session/scenario', {
        sessionId: assigned.sessionId,
        answerHistory: [scenarioAnswerFor(assigned.conditionX)],
        durationMs: 15000,
      })
      assert.equal(branchScenario.response.status, 200)
      assert.equal(branchScenario.body.passed, true)
      assert.equal(branchScenario.body.state.flowStage, 'rd')
    }

    const scenarioAnswer = scenarioAnswerFor(goodPreflight.body.state.conditionX)
    const scenario = await post('/api/online-points/session/scenario', {
      sessionId,
      answerHistory: [scenarioAnswer],
      durationMs: 32000,
    })
    assert.equal(scenario.response.status, 200)
    assert.equal(scenario.body.passed, true)
    assert.equal(scenario.body.state.flowStage, 'rd')

    const rd = await post('/api/online-points/session/rd', {
      sessionId,
      answers: [7, 6, 5, 4],
      durationMs: 18000,
    })
    assert.equal(rd.response.status, 200)
    assert.equal(rd.body.state.flowStage, 'm')

    const moralDisengagement = await post('/api/online-points/session/moral-disengagement', {
      sessionId,
      answers: {
        MD1: 1,
        MD2: 2,
        MD3: 3,
        MD4: 4,
      },
      durationMs: 41000,
    })
    assert.equal(moralDisengagement.response.status, 200)
    assert.equal(moralDisengagement.body.state.flowStage, 'regulation')

    const regulation = await post('/api/online-points/session/regulation', {
      sessionId,
      acknowledged: true,
      durationMs: 12000,
    })
    assert.equal(regulation.response.status, 200)
    assert.equal(regulation.body.state.flowStage, 'task')
    assert.equal(regulation.body.state.regulationAcknowledged, true)

    const earlyReminder = await post('/api/online-points/session/regulation-reminder', { sessionId })
    assert.equal(earlyReminder.response.status, 409)
    assert.equal(earlyReminder.body.error, 'regulation_reminder_not_due')

    const incompleteCompletion = await post('/api/online-points/session/complete', {
      sessionId,
      feedbackResponsiveness: 4,
      believedChoiceAffectedOpponent: 5,
      rewardConsequenceImportance: 3,
      seriousCompletion: 7,
      interruptionLevel: 1,
      motiveRetaliation: 4,
      motiveHarm: 4,
      motiveWinBelief: 1,
      motiveConvenience: 1,
      motiveScoreGap: 4,
      regulationCheck: [4, 4, 4],
    })
    assert.equal(incompleteCompletion.response.status, 409)
    assert.equal(incompleteCompletion.body.error, 'flow_stage_not_ready')

    const missingDraft = await post('/api/online-points/trial/settle', {
      sessionId,
      trialIndex: 0,
      participantDeductionChoice: 10,
      participantRtMs: 250,
      idempotencyKey: 'trial-0-first',
    })
    assert.equal(missingDraft.response.status, 409)
    assert.equal(missingDraft.body.error, 'trial_draft_missing')

    const firstDraft = await post('/api/online-points/trial/draft', {
      sessionId,
      trialIndex: 0,
      participantDeductionChoice: 10,
      idempotencyKey: 'trial-0-first',
    })
    assert.equal(firstDraft.response.status, 200)
    assert.equal(firstDraft.body.state.pendingDraft.trial_index, 0)
    assert.equal(firstDraft.body.state.pendingDraft.participant_deduction_choice, 10)

    const first = await post('/api/online-points/trial/settle', {
      sessionId,
      trialIndex: 0,
      participantDeductionChoice: 10,
      participantRtMs: 250,
      idempotencyKey: 'trial-0-first',
    })
    assert.equal(first.response.status, 200)
    assert.equal(first.body.trial.deducted_from_opponent, 10)
    assert.equal(first.body.state.opponentPoints, 190)
    let previousParticipantPoints = first.body.trial.participant_points_after
    let previousOpponentPoints = first.body.trial.opponent_points_after

    const duplicate = await post('/api/online-points/trial/settle', {
      sessionId,
      trialIndex: 0,
      participantDeductionChoice: 10,
      participantRtMs: 250,
      idempotencyKey: 'trial-0-first',
    })
    assert.equal(duplicate.response.status, 200)
    assert.equal(duplicate.body.idempotent, true)
    assert.equal(duplicate.body.state.opponentPoints, 190)

    const outOfOrder = await post('/api/online-points/trial/settle', {
      sessionId,
      trialIndex: 2,
      participantDeductionChoice: 10,
      participantRtMs: 250,
      idempotencyKey: 'trial-2-early',
    })
    assert.equal(outOfOrder.response.status, 409)
    assert.equal(outOfOrder.body.expectedTrialIndex, 1)

    for (let trialIndex = 1; trialIndex < 15; trialIndex += 1) {
      const drafted = await post('/api/online-points/trial/draft', {
        sessionId,
        trialIndex,
        participantDeductionChoice: 10,
        idempotencyKey: 'trial-' + trialIndex + '-first',
      })
      assert.equal(drafted.response.status, 200)
      assert.equal(drafted.body.state.pendingDraft.trial_index, trialIndex)
      const settled = await post('/api/online-points/trial/settle', {
        sessionId,
        trialIndex,
        participantDeductionChoice: 10,
        participantRtMs: 250,
        idempotencyKey: 'trial-' + trialIndex + '-first',
      })
      assert.equal(settled.response.status, 200)
      assert.equal(settled.body.trial.trial_index, trialIndex)
      assert.equal(settled.body.trial.participant_points_before, previousParticipantPoints)
      assert.equal(settled.body.trial.opponent_points_before, previousOpponentPoints)
      assert.equal(settled.body.state.nextTrialIndex, trialIndex + 1)
      previousParticipantPoints = settled.body.trial.participant_points_after
      previousOpponentPoints = settled.body.trial.opponent_points_after
      if (trialIndex === 6) {
        const blockedByReminder = await post('/api/online-points/trial/draft', {
          sessionId,
          trialIndex: 7,
          participantDeductionChoice: 10,
          idempotencyKey: 'trial-7-first',
        })
        assert.equal(blockedByReminder.response.status, 409)
        assert.equal(blockedByReminder.body.error, 'regulation_reminder_required')
        const reminder = await post('/api/online-points/session/regulation-reminder', { sessionId })
        assert.equal(reminder.response.status, 200)
        assert.equal(reminder.body.state.regulationReminderSeen, true)
      }
    }

    const state = await jsonRequest('/api/online-points/session/' + sessionId)
    assert.equal(state.response.status, 200)
    assert.equal(state.body.state.nextTrialIndex, 15)
    assert.equal(state.body.state.participantPoints, 174)
    assert.equal(state.body.state.opponentPoints, 120)
    assert.equal(state.body.state.flowStage, 'checks')
    assert.equal(state.body.state.trials.filter((row) => row.phase === 'initial').length, 7)
    assert.equal(state.body.state.trials.filter((row) => row.phase === 'mutual').length, 8)
    assert.equal(state.body.state.trials[5].deducted_from_participant, 0)
    assert.equal(state.body.state.trials[6].phase, 'initial')
    assert.equal(state.body.state.trials[6].deducted_from_participant, 7)
    assert.equal(state.body.state.trials[7].phase, 'mutual')
    assert.deepEqual(
      state.body.state.trials.map((row) => row.trial_index),
      Array.from({ length: 15 }, (_, trialIndex) => trialIndex)
    )

    const finalRetry = await post('/api/online-points/trial/settle', {
      sessionId,
      trialIndex: 14,
      participantDeductionChoice: 10,
      participantRtMs: 250,
      idempotencyKey: 'trial-14-first',
    })
    assert.equal(finalRetry.response.status, 200)
    assert.equal(finalRetry.body.idempotent, true)
    assert.equal(finalRetry.body.state.flowStage, 'checks')

    const completed = await post('/api/online-points/session/complete', {
      sessionId,
      feedbackResponsiveness: 4,
      believedChoiceAffectedOpponent: 5,
      rewardConsequenceImportance: 3,
      seriousCompletion: 7,
      interruptionLevel: 1,
      motiveRetaliation: 7,
      motiveHarm: 7,
      motiveWinBelief: 1,
      motiveConvenience: 1,
      motiveScoreGap: 7,
      regulationCheck: [5, 6, 5],
    })
    assert.equal(completed.response.status, 200)
    assert.equal(completed.body.dv.y_initial, 10)
    assert.equal(completed.body.dv.y_mutual, 10)
    assert.equal(completed.body.dv.y_initial_n, 7)
    assert.equal(completed.body.dv.y_mutual_n, 8)

    const subjectCsv = await fetch(
      base + '/api/online-points/export.csv?token=' + exportToken
    ).then((response) => response.text())
    assert.match(subjectCsv, /q2_v4_0_reappraisal_15trial_integration/)
    assert.match(subjectCsv, /online-test-001/)
    assert.match(subjectCsv, /174,120/)
    assert.match(subjectCsv, /trial_drafts_json/)
    assert.match(subjectCsv, /scenario_duration_ms/)
    assert.match(subjectCsv, /rd_duration_ms/)
    assert.match(subjectCsv, /moral_disengagement_duration_ms/)
    assert.match(subjectCsv, /regulation_duration_ms/)
    assert.match(subjectCsv, /motive_score_gap/)
    assert.match(subjectCsv, /feedback_responsiveness/)
    assert.match(subjectCsv, /32000/)
    assert.match(subjectCsv, /41000/)

    const trialCsv = await fetch(
      base + '/api/online-points/export_trials.csv?token=' + exportToken
    ).then((response) => response.text())
    assert.match(trialCsv, /choice_selected_at/)
    assert.match(trialCsv, /score_gap_before/)
    assert.match(trialCsv, /participant_behind_before/)
    assert.match(trialCsv, /prior_participant_choice/)
    assert.match(trialCsv, /choice_change_from_previous/)
    assert.match(trialCsv, /prior_deducted_from_participant/)
    assert.equal(trialCsv.trim().split(/\r?\n/).length, 16)

    console.log('Online points integration test passed')
  } finally {
    child.kill('SIGTERM')
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.rmSync(dbPath + suffix, { force: true })
      } catch {
        // best effort cleanup
      }
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
