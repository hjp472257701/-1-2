const path = require('path')
const Database = require('better-sqlite3')

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.sqlite3')

/** @type {import('better-sqlite3').Database} */
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

db.exec(`
  create table if not exists participants (
    participant_id text primary key,
    md real,
    cr real,
    created_at text not null default (datetime('now'))
  );

  create table if not exists sessions (
    session_id text primary key,
    participant_id text not null,
    user_agent text,
    hook_read_started_at text,
    hook_read_ended_at text,
    anger_rating integer,
    started_at text not null default (datetime('now')),
    completed_at text,
    foreign key (participant_id) references participants(participant_id)
  );

  create table if not exists trials (
    id integer primary key autoincrement,
    session_id text not null,
    trial_index integer not null,
    outcome text not null, -- 'win' | 'loss'
    participant_rt_ms integer,
    participant_intensity integer not null,
    participant_duration_ms integer not null,
    opponent_intensity integer,
    opponent_duration_ms integer,
    created_at text not null default (datetime('now')),
    unique(session_id, trial_index),
    foreign key (session_id) references sessions(session_id)
  );

  create table if not exists invites (
    token text primary key,
    participant_id text,
    label text,
    max_uses integer not null default 1,
    use_count integer not null default 0,
    expires_at text,
    created_at text not null default (datetime('now'))
  );

  create table if not exists questionnaire_sessions (
    questionnaire_session_id text primary key,
    participant_id text not null,
    schema_version text not null,
    user_agent text,
    started_at text not null default (datetime('now')),
    completed_at text,
    duration_ms integer,
    missing_count integer not null default 0,
    completed_once integer not null default 1,
    attention_correct integer,
    attention_total integer,
    attention_passed integer,
    soft_social_flag integer,
    soft_conflict_flag integer,
    response_quality_level text,
    exclude_recommended integer,
    foreign key (participant_id) references participants(participant_id)
  );

  create table if not exists questionnaire_items (
    item_id text primary key,
    scale_id text not null,
    item_text text not null,
    reverse_scored integer not null default 0
  );

  create table if not exists questionnaire_answers (
    id integer primary key autoincrement,
    questionnaire_session_id text not null,
    participant_id text not null,
    scale_id text not null,
    item_id text not null,
    answer_value real not null,
    created_at text not null default (datetime('now')),
    unique(questionnaire_session_id, item_id),
    foreign key (questionnaire_session_id) references questionnaire_sessions(questionnaire_session_id),
    foreign key (participant_id) references participants(participant_id)
  );

  create table if not exists participant_demographics (
    participant_id text primary key,
    gender text,
    age integer,
    grade text,
    major text,
    income text,
    only_child text,
    student_cadre text,
    scholarship text,
    updated_at text not null default (datetime('now')),
    foreign key (participant_id) references participants(participant_id)
  );

  create table if not exists participant_scales_snapshot (
    participant_id text primary key,
    questionnaire_session_id text,
    prds real,
    pmd real,
    aq real,
    aq_physical real,
    aq_verbal real,
    aq_anger real,
    aq_hostility real,
    erq_cr real,
    item_count integer not null default 0,
    updated_at text not null default (datetime('now')),
    foreign key (participant_id) references participants(participant_id),
    foreign key (questionnaire_session_id) references questionnaire_sessions(questionnaire_session_id)
  );
`)

try {
  db.exec(`alter table sessions add column invite_token text`)
} catch (e) {
  if (!/duplicate column name/i.test(String(e.message))) throw e
}

for (const col of [
  'prds real',
  'pmd real',
  'aq real',
  'aq_physical real',
  'aq_verbal real',
  'aq_anger real',
  'aq_hostility real',
  'erq_cr real',
  'answer_count integer',
  'attention_correct integer',
  'attention_total integer',
  'attention_passed integer',
  'soft_social_flag integer',
  'soft_conflict_flag integer',
  'response_quality_level text',
  'exclude_recommended integer',
]) {
  try {
    db.exec(`alter table questionnaire_sessions add column ${col}`)
  } catch (e) {
    if (!/duplicate column name/i.test(String(e.message))) throw e
  }
}

module.exports = { db, DB_PATH }

