import { nanoid } from 'nanoid';
import { createConversation, logSession } from './memory/store';
import { runAssistant } from './assistant';

interface Env {
  AI: Ai;
  DB: D1Database;
  CACHE: KVNamespace;
  ANTHROPIC_API_KEY: string;
  GITHUB_TOKEN: string;
  ENVIRONMENT: string;
}

const CORS: HeadersInit = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Session-Id',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const { pathname } = new URL(request.url);

    if (pathname === '/api/chat' && request.method === 'POST') {
      return handleChat(request, env);
    }

    if (pathname === '/api/health' && request.method === 'GET') {
      return json({ ok: true, env: env.ENVIRONMENT });
    }

    return json({ error: 'Not found' }, 404);
  },
};

async function handleChat(request: Request, env: Env): Promise<Response> {
  let body: { message?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const message = body.message?.trim();
  if (!message) return json({ error: 'Missing message' }, 400);

  const sessionId = request.headers.get('X-Session-Id') || nanoid();
  const sessionKey = `session:${sessionId}`;

  let conversationId = await env.CACHE.get(sessionKey);
  if (!conversationId) {
    conversationId = await createConversation(env.DB);
    // 7-day session TTL
    await env.CACHE.put(sessionKey, conversationId, { expirationTtl: 604800 });
  }

  try {
    const result = await runAssistant({
      db: env.DB,
      githubToken: env.GITHUB_TOKEN,
      anthropicKey: env.ANTHROPIC_API_KEY,
      conversationId,
      userMessage: message,
    });

    if (result.memoriesAdded > 0 || result.tasksUpdated > 0) {
      await logSession(
        env.DB,
        conversationId,
        null,
        result.reply.slice(0, 200),
        result.memoriesAdded,
        result.tasksUpdated
      );
    }

    return json({ reply: result.reply, sessionId });
  } catch (e) {
    console.error('Assistant error:', e);
    return json({ error: 'Assistant failed', detail: String(e) }, 500);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
