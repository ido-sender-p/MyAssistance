-- ============================================================
-- CONVERSATIONS + MESSAGES
-- ============================================================

CREATE TABLE IF NOT EXISTS conversations (
  id          TEXT PRIMARY KEY,
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at    TEXT,
  summary     TEXT  -- generated at end of session
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content         TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);

-- ============================================================
-- LONG-TERM MEMORY
-- ============================================================

CREATE TABLE IF NOT EXISTS memories (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL CHECK (type IN ('fact', 'preference', 'decision', 'task', 'note')),
  project    TEXT CHECK (project IN ('wildock', 'viibeu', 'myassistance', 'general')),
  content    TEXT NOT NULL,
  tags       TEXT, -- comma-separated
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- WILDOCK
-- ============================================================

CREATE TABLE IF NOT EXISTS wildock_tasks (
  id          TEXT PRIMARY KEY,  -- e.g. FIX-FE-012, FEAT-P1-003
  title       TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('fix', 'feature', 'prod')),
  status      TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')) DEFAULT 'open',
  phase       TEXT, -- 'phase1' | 'phase2' | 'phase3' | null for fixes
  notes       TEXT, -- decisions / context on this task
  started_at  TEXT,
  done_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wildock_decisions (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  task_id     TEXT REFERENCES wildock_tasks(id),
  decided_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- VIIBEU
-- ============================================================

CREATE TABLE IF NOT EXISTS viibeu_briefs (
  id            TEXT PRIMARY KEY,
  client_name   TEXT NOT NULL,
  business_name TEXT NOT NULL,
  phone         TEXT,
  status        TEXT NOT NULL CHECK (status IN ('new', 'reviewed', 'in_progress', 'delivered', 'cancelled')) DEFAULT 'new',
  timeline      TEXT, -- 'urgent' | 'normal' | 'flexible'
  brief_data    TEXT, -- full JSON of the brief (all 10 steps)
  notes         TEXT, -- Ido's notes on this client/project
  submitted_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS viibeu_decisions (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  decided_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- SESSION TRACKING (updated every session)
-- ============================================================

CREATE TABLE IF NOT EXISTS session_log (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  project         TEXT, -- which project was worked on
  summary         TEXT, -- what was done this session
  memories_added  INTEGER DEFAULT 0,
  tasks_updated   INTEGER DEFAULT 0,
  logged_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
