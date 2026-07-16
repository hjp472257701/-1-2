const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const Database = require('better-sqlite3')

const port = 34119
const base = `http://127.0.0.1:${port}`
const dbPath = path.join(os.tmpdir(), `q2-v2-test-${process.pid}.sqlite3`)
const exportToken = 'integration-test-token'

function seedLegacyDatabase() {
  const db = new Database(dbPath)
  db.exec(`
    create table participants (
      participant_id text primary key,
      md real,
      cr real,
      created_at text not null default (datetime('now'))
    );
    create table sessions (
      session_id text primary key,
      participant_id text not null,
      user_agent text,
      hook_read_started_at text,
      hook_read_ended_at text,
      anger_rating integer,
      started_at text not null default (datetime('now')),
      completed_at text
    );
    create table invites (
      token text primary key,
      participant_id text,
      label text,
      max_uses integer not null default 1,
      use_count integer not null default 0,
      expires_at text,
      created_at text not null default (datetime('now'))
    );
    insert into participants (participant_id, md, cr) values ('legacy-001', 20, 22);
    insert into sessions (session_id, participant_id, completed_at)
      values ('legacy-session', 'legacy-001', '2026-07-01T00:00:00.000Z');
    insert into invites (token, participant_id, label) values ('legacy-invite', 'legacy-001', 'old link');
  `)
  db.close()
}

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
      reject(new Error(`server_exited_${code}`))
    })
  })
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(`${base}${url}`, options)
  const body = await response.json().catch(() => ({}))
  return { response, body }
}

async function main() {
  seedLegacyDatabase()
  const child = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      DB_PATH: dbPath,
      PORT: String(port),
      EXPORT_TOKEN: exportToken,
      STUDY_VERSION: 'q2_v2_integration',
      DEFAULT_DATA_ROLE: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    await waitForServer(child)

    const legacyInvite = await jsonRequest('/api/invite/legacy-invite')
    assert.equal(legacyInvite.response.status, 410)
    assert.equal(legacyInvite.body.error, 'legacy')

    const invite = await jsonRequest('/api/admin/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        exportToken,
        participantId: 'pilot-001',
        label: 'integration pilot',
        dataRole: 'pilot',
        maxUses: 1,
      }),
    })
    assert.equal(invite.response.status, 200)
    assert.equal(invite.body.dataRole, 'pilot')

    const started = await jsonRequest('/api/session/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        participantId: 'pilot-001',
        md: 30,
        cr: 28,
        inviteToken: invite.body.token,
        userAgent: 'integration-test',
      }),
    })
    assert.equal(started.response.status, 200)
    assert.equal(started.body.studyVersion, 'q2_v2_integration')
    assert.equal(started.body.dataRole, 'pilot')
    assert.equal(started.body.plan.length, 25)
    const sessionId = started.body.sessionId

    const earlyHook = await jsonRequest('/api/session/hook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, angerRating: 5 }),
    })
    assert.equal(earlyHook.response.status, 409)
    assert.equal(earlyHook.body.error, 'preflight_not_passed')

    const badGate = await jsonRequest('/api/session/preflight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        practiceRtHistory: [[250, 300, 350]],
        comprehensionHistory: [
          { winnerListener: 'self', settingTime: 'after', goAction: 'wait' },
        ],
      }),
    })
    assert.equal(badGate.response.status, 200)
    assert.equal(badGate.body.gatePassed, false)

    const goodGate = await jsonRequest('/api/session/preflight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        practiceRtHistory: [[250, 300, 350]],
        comprehensionHistory: [
          { winnerListener: 'self', settingTime: 'after', goAction: 'wait' },
          { winnerListener: 'partner', settingTime: 'before', goAction: 'press' },
        ],
      }),
    })
    assert.equal(goodGate.response.status, 200)
    assert.equal(goodGate.body.gatePassed, true)
    assert.equal(goodGate.body.comprehensionFirstPass, false)

    const hook = await jsonRequest('/api/session/hook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, angerRating: 6 }),
    })
    assert.equal(hook.response.status, 200)

    for (let trialIndex = 0; trialIndex < 25; trialIndex += 1) {
      const loss = trialIndex >= 5 && trialIndex % 2 === 1
      const trial = await jsonRequest('/api/trial', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          trialIndex,
          outcome: loss ? 'loss' : 'win',
          participantRtMs: 300,
          participantIntensity: 4,
          participantDurationMs: 1000,
          opponentIntensity: loss ? 5 : null,
          opponentDurationMs: loss ? 1000 : null,
        }),
      })
      assert.equal(trial.response.status, 200)
    }

    const completed = await jsonRequest('/api/session/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        manipulation: {
          unfriendly: 5,
          provoked: 5,
          punishmentHeavy: 4,
          angry: 5,
          retaliation: 4,
        },
      }),
    })
    assert.equal(completed.response.status, 200)

    const subjectCsv = await fetch(`${base}/api/export.csv?token=${exportToken}`).then((r) => r.text())
    assert.match(subjectCsv, /study_version,data_role/)
    assert.match(subjectCsv, /legacy-001,legacy-session,q2_v1_legacy,legacy/)
    assert.match(subjectCsv, /q2_v2_integration,pilot/)
    assert.match(subjectCsv, /,1,5,5,4,6,25,20,4,/)
    assert.match(subjectCsv, /\[\[250,300,350\]\]/)

    const trialCsv = await fetch(`${base}/api/export_trials.csv?token=${exportToken}`).then((r) => r.text())
    assert.match(trialCsv, /study_version,data_role/)
    const trialLines = trialCsv.trim().split(/\r?\n/)
    assert.equal(trialLines.length, 26)

    console.log('V2 integration test passed')
  } finally {
    child.kill('SIGTERM')
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.rmSync(`${dbPath}${suffix}`, { force: true })
      } catch {
        // best-effort test cleanup
      }
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
