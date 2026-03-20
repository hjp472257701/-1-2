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
`)

module.exports = { db, DB_PATH }

