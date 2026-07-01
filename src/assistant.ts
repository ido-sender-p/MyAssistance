import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt } from './config/prompts';
import { toolDefinitions, workerToolDefinitions, executeTool, type ToolName } from './tools/index';
import {
  getMemories,
  formatMemoriesForPrompt,
  saveMessage,
  getRecentMessages,
} from './memory/store';

interface RunOptions {
  ai: Ai;
  db: D1Database;
  githubToken: string;
  anthropicKey?: string;
  conversationId: string;
  userMessage: string;
  cfAccountId: string;
  cfWorkersToken: string;
  cfZonesToken: string;
  cfAccessToken: string;
}

export interface RunResult {
  reply: string;
  memoriesAdded: number;
  tasksUpdated: number;
}

// ── Streaming entry point ─────────────────────────────────────

export async function streamAssistant(
  opts: RunOptions,
  writer: WritableStreamDefaultWriter<Uint8Array>
): Promise<void> {
  const encoder = new TextEncoder();
  const sse = async (data: object) => {
    await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  };

  try {
    const { ai, db, githubToken, anthropicKey, conversationId, userMessage,
            cfAccountId, cfWorkersToken, cfZonesToken, cfAccessToken } = opts;

    const cfTokens = { cfAccountId, cfWorkersToken, cfZonesToken, cfAccessToken };

    const memories = await getMemories(db);
    const systemPrompt = buildSystemPrompt(formatMemoriesForPrompt(memories));
    await saveMessage(db, conversationId, 'user', userMessage);
    const history = await getRecentMessages(db, conversationId, 20);
    const pastMessages = history.filter(m => m.role !== 'tool');

    const result = anthropicKey
      ? await runWithAnthropic({ anthropicKey, systemPrompt, pastMessages, db, githubToken, conversationId, cfTokens })
      : await runWithWorkersAI({ ai, systemPrompt, pastMessages, db, githubToken, conversationId, cfTokens });

    // Stream reply word-by-word
    const tokens = result.reply.split(/(\s+)/).filter(Boolean);
    const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

    for (const token of tokens) {
      await sse({ type: 'chunk', text: token });
      await wait(token.match(/[.!?\n]/) ? 60 : 18);
    }

    await sse({ type: 'done' });
  } catch (e) {
    await sse({ type: 'error', error: String(e) });
  } finally {
    writer.close();
  }
}

// ── Anthropic backend ─────────────────────────────────────────

async function runWithAnthropic(opts: {
  anthropicKey: string;
  systemPrompt: string;
  pastMessages: { role: string; content: string }[];
  db: D1Database;
  githubToken: string;
  conversationId: string;
  cfTokens: Record<string, string>;
}): Promise<RunResult> {
  const { anthropicKey, systemPrompt, pastMessages, db, githubToken, conversationId, cfTokens } = opts;
  const client = new Anthropic({ apiKey: anthropicKey });

  const messages: Anthropic.MessageParam[] = pastMessages.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  let memoriesAdded = 0;
  let tasksUpdated = 0;
  let iterations = 0;

  while (iterations++ < 6) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8096,
      system: systemPrompt,
      tools: toolDefinitions,
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('');
      await saveMessage(db, conversationId, 'assistant', text);
      return { reply: text, memoriesAdded, tasksUpdated };
    }

    if (response.stop_reason === 'tool_use') {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        let result: unknown;
        try {
          result = await executeTool(block.name as ToolName, block.input as Record<string, unknown>, { db, githubToken, ...cfTokens });
          if (block.name === 'memory_save') memoriesAdded++;
          if (block.name === 'wildock_task_update') tasksUpdated++;
        } catch (e) {
          result = { error: String(e) };
        }
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    break;
  }

  return { reply: 'Error: unexpected loop exit', memoriesAdded, tasksUpdated };
}

// ── Workers AI backend ────────────────────────────────────────

// llama sometimes embeds tool call JSON directly in content string instead of tool_calls
function extractContentToolCalls(content: string): Array<{name: string; arguments: Record<string, unknown>}> | null {
  const trimmed = content.trim();
  const attempts = [trimmed];
  const lastBrace = trimmed.lastIndexOf('{');
  if (lastBrace > 0) attempts.push(trimmed.slice(lastBrace));

  for (const attempt of attempts) {
    try {
      const p = JSON.parse(attempt) as Record<string, unknown>;
      if (p.name && typeof p.name === 'string') {
        return [{ name: p.name, arguments: (p.parameters ?? p.arguments ?? {}) as Record<string, unknown> }];
      }
    } catch { /* not valid JSON */ }
  }
  return null;
}

type AIMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: unknown[]; tool_call_id?: string };

type OAIResponse = {
  choices?: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
    finish_reason: string;
  }>;
  response?: string;
  tool_calls?: Array<{ name: string; arguments: Record<string, unknown> | string }>;
};

async function runWithWorkersAI(opts: {
  ai: Ai;
  systemPrompt: string;
  pastMessages: { role: string; content: string }[];
  db: D1Database;
  githubToken: string;
  conversationId: string;
  cfTokens: Record<string, string>;
}): Promise<RunResult> {
  const { ai, systemPrompt, pastMessages, db, githubToken, conversationId, cfTokens } = opts;

  const messages: AIMessage[] = [
    { role: 'system', content: systemPrompt },
    ...pastMessages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ];

  let memoriesAdded = 0;
  let tasksUpdated = 0;
  let iterations = 0;

  while (iterations++ < 6) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (ai.run as any)('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages,
      tools: workerToolDefinitions,
      max_tokens: 4096,
    }) as OAIResponse;

    const choice = response.choices?.[0];
    const oaiToolCalls = choice?.message?.tool_calls;
    const legacyToolCalls = response.tool_calls;

    if (!oaiToolCalls?.length && !legacyToolCalls?.length) {
      const reply = choice?.message?.content ?? response.response ?? '';

      // Handle tool call JSON embedded in content string
      const embeddedCalls = extractContentToolCalls(reply);
      if (embeddedCalls?.length) {
        messages.push({ role: 'assistant', content: reply });
        for (const call of embeddedCalls) {
          let result: unknown;
          try {
            result = await executeTool(call.name as ToolName, call.arguments, { db, githubToken, ...cfTokens });
            if (call.name === 'memory_save') memoriesAdded++;
            if (call.name === 'wildock_task_update') tasksUpdated++;
          } catch (e) {
            result = { error: String(e) };
          }
          messages.push({ role: 'tool', content: JSON.stringify(result) });
        }
        continue;
      }

      await saveMessage(db, conversationId, 'assistant', reply);
      return { reply, memoriesAdded, tasksUpdated };
    }

    if (oaiToolCalls?.length) {
      messages.push({ role: 'assistant', content: null, tool_calls: oaiToolCalls });
      for (const call of oaiToolCalls) {
        let result: unknown;
        try {
          result = await executeTool(call.function.name as ToolName, JSON.parse(call.function.arguments), { db, githubToken, ...cfTokens });
          if (call.function.name === 'memory_save') memoriesAdded++;
          if (call.function.name === 'wildock_task_update') tasksUpdated++;
        } catch (e) {
          result = { error: String(e) };
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
      continue;
    }

    if (legacyToolCalls?.length) {
      messages.push({ role: 'assistant', content: JSON.stringify(legacyToolCalls) });
      for (const call of legacyToolCalls) {
        const args = typeof call.arguments === 'string'
          ? JSON.parse(call.arguments) as Record<string, unknown>
          : call.arguments as Record<string, unknown>;
        let result: unknown;
        try {
          result = await executeTool(call.name as ToolName, args, { db, githubToken, ...cfTokens });
          if (call.name === 'memory_save') memoriesAdded++;
          if (call.name === 'wildock_task_update') tasksUpdated++;
        } catch (e) {
          result = { error: String(e) };
        }
        messages.push({ role: 'tool', content: JSON.stringify(result) });
      }
    }
  }

  return { reply: 'הגעתי למגבלת הסבבים. נסה שוב.', memoriesAdded, tasksUpdated };
}
