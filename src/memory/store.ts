import { nanoid } from 'nanoid';

export interface Memory {
  id: string;
  type: 'fact' | 'preference' | 'decision' | 'task' | 'note';
  project: 'wildock' | 'viibeu' | 'myassistance' | 'general' | null;
  content: string;
  tags: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  created_at: string;
}

// ── Conversations ────────────────────────────────────────────

export async function createConversation(db: D1Database): Promise<string> {
  const id = nanoid();
  await db.prepare('INSERT INTO conversations (id) VALUES (?)').bind(id).run();
  return id;
}

export async function closeConversation(db: D1Database, id: string, summary: string): Promise<void> {
  await db
    .prepare("UPDATE conversations SET ended_at = datetime('now'), summary = ? WHERE id = ?")
    .bind(summary, id)
    .run();
}

// ── Messages ─────────────────────────────────────────────────

export async function saveMessage(
  db: D1Database,
  conversationId: string,
  role: Message['role'],
  content: string
): Promise<void> {
  await db
    .prepare('INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)')
    .bind(nanoid(), conversationId, role, content)
    .run();
}

export async function getRecentMessages(
  db: D1Database,
  conversationId: string,
  limit = 20
): Promise<Message[]> {
  const result = await db
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?')
    .bind(conversationId, limit)
    .all<Message>();
  return result.results.reverse();
}

// ── Memories ─────────────────────────────────────────────────

export async function saveMemory(
  db: D1Database,
  memory: Omit<Memory, 'id' | 'created_at' | 'updated_at'>
): Promise<string> {
  const id = nanoid();
  await db
    .prepare(`
      INSERT INTO memories (id, type, project, content, tags)
      VALUES (?, ?, ?, ?, ?)
    `)
    .bind(id, memory.type, memory.project ?? null, memory.content, memory.tags ?? null)
    .run();
  return id;
}

export async function updateMemory(
  db: D1Database,
  id: string,
  content: string
): Promise<void> {
  await db
    .prepare("UPDATE memories SET content = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(content, id)
    .run();
}

export async function getMemories(
  db: D1Database,
  project?: Memory['project']
): Promise<Memory[]> {
  if (project) {
    const result = await db
      .prepare('SELECT * FROM memories WHERE project = ? OR project = ? ORDER BY updated_at DESC')
      .bind(project, 'general')
      .all<Memory>();
    return result.results;
  }
  const result = await db
    .prepare('SELECT * FROM memories ORDER BY updated_at DESC')
    .all<Memory>();
  return result.results;
}

export async function searchMemories(
  db: D1Database,
  query: string,
  project?: Memory['project']
): Promise<Memory[]> {
  const like = `%${query}%`;
  if (project) {
    const result = await db
      .prepare(`
        SELECT * FROM memories
        WHERE (project = ? OR project = 'general')
          AND (content LIKE ? OR tags LIKE ?)
        ORDER BY updated_at DESC
        LIMIT 10
      `)
      .bind(project, like, like)
      .all<Memory>();
    return result.results;
  }
  const result = await db
    .prepare(`
      SELECT * FROM memories
      WHERE content LIKE ? OR tags LIKE ?
      ORDER BY updated_at DESC
      LIMIT 10
    `)
    .bind(like, like)
    .all<Memory>();
  return result.results;
}

export function formatMemoriesForPrompt(memories: Memory[]): string {
  if (!memories.length) return 'No memories loaded.';
  return memories
    .map(m => `[${m.type}${m.project ? ` / ${m.project}` : ''}] ${m.content}`)
    .join('\n');
}

// ── Session log ──────────────────────────────────────────────

export async function logSession(
  db: D1Database,
  conversationId: string,
  project: string | null,
  summary: string,
  memoriesAdded: number,
  tasksUpdated: number
): Promise<void> {
  await db
    .prepare(`
      INSERT INTO session_log (id, conversation_id, project, summary, memories_added, tasks_updated)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .bind(nanoid(), conversationId, project ?? null, summary, memoriesAdded, tasksUpdated)
    .run();
}

// ── Wildock tasks ────────────────────────────────────────────

export async function upsertWildockTask(
  db: D1Database,
  task: { id: string; title: string; type: 'fix' | 'feature' | 'prod'; status: string; phase?: string; notes?: string }
): Promise<void> {
  await db
    .prepare(`
      INSERT INTO wildock_tasks (id, title, type, status, phase, notes)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        notes = excluded.notes,
        updated_at = datetime('now'),
        started_at = CASE WHEN excluded.status = 'in_progress' AND started_at IS NULL THEN datetime('now') ELSE started_at END,
        done_at   = CASE WHEN excluded.status = 'done' THEN datetime('now') ELSE done_at END
    `)
    .bind(task.id, task.title, task.type, task.status, task.phase ?? null, task.notes ?? null)
    .run();
}

export async function getOpenWildockTasks(db: D1Database): Promise<unknown[]> {
  const result = await db
    .prepare("SELECT * FROM wildock_tasks WHERE status IN ('open', 'in_progress') ORDER BY updated_at DESC")
    .all();
  return result.results;
}

// ── viibeu briefs ────────────────────────────────────────────

export async function saveBrief(
  db: D1Database,
  brief: { id: string; client_name: string; business_name: string; phone?: string; timeline?: string; brief_data: string }
): Promise<void> {
  await db
    .prepare(`
      INSERT OR IGNORE INTO viibeu_briefs (id, client_name, business_name, phone, timeline, brief_data)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .bind(brief.id, brief.client_name, brief.business_name, brief.phone ?? null, brief.timeline ?? null, brief.brief_data)
    .run();
}

export async function getBriefs(db: D1Database, status?: string): Promise<unknown[]> {
  if (status) {
    const result = await db
      .prepare('SELECT id, client_name, business_name, status, timeline, submitted_at, notes FROM viibeu_briefs WHERE status = ? ORDER BY submitted_at DESC')
      .bind(status)
      .all();
    return result.results;
  }
  const result = await db
    .prepare('SELECT id, client_name, business_name, status, timeline, submitted_at, notes FROM viibeu_briefs ORDER BY submitted_at DESC')
    .all();
  return result.results;
}
