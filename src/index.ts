import { nanoid } from 'nanoid';
import { createConversation, logSession } from './memory/store';
import { streamAssistant } from './assistant';
import { UI_HTML } from './ui';

interface Env {
  AI: Ai;
  DB: D1Database;
  CACHE: KVNamespace;
  ANTHROPIC_API_KEY?: string;
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

    if (pathname === '/api/debug-ai' && request.method === 'GET') {
      const raw = await (env.AI.run as any)('@cf/zai-org/glm-4.7-flash', {
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Say hello in one sentence.' },
        ],
        max_tokens: 256,
      });
      return json({ raw });
    }

    if (pathname === '/' || pathname === '') {
      return new Response(UI_HTML, {
        headers: { 'Content-Type': 'text/html;charset=UTF-8' },
      });
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
    await env.CACHE.put(sessionKey, conversationId, { expirationTtl: 604800 });
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Send session ID as first SSE event
  writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'start', sessionId })}\n\n`));

  // Run assistant in background, stream to client
  streamAssistant(
    {
      ai: env.AI,
      db: env.DB,
      githubToken: env.GITHUB_TOKEN,
      anthropicKey: env.ANTHROPIC_API_KEY,
      conversationId,
      userMessage: message,
    },
    writer
  ).catch(() => writer.close());

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Session-Id',
    },
  });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
