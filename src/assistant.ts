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
}

export interface RunResult {
  reply: string;
  memoriesAdded: number;
  tasksUpdated: number;
}

export async function runAssistant(opts: RunOptions): Promise<RunResult> {
  const { ai, db, githubToken, anthropicKey, conversationId, userMessage } = opts;

  const memories = await getMemories(db);
  const systemPrompt = buildSystemPrompt(formatMemoriesForPrompt(memories));

  await saveMessage(db, conversationId, 'user', userMessage);

  const history = await getRecentMessages(db, conversationId, 20);
  const pastMessages = history.filter(m => m.role !== 'tool');

  if (anthropicKey) {
    return runWithAnthropic({ anthropicKey, systemPrompt, pastMessages, userMessage, db, githubToken, conversationId });
  }
  return runWithWorkersAI({ ai, systemPrompt, pastMessages, userMessage, db, githubToken, conversationId });
}

// ── Anthropic backend ─────────────────────────────────────────

async function runWithAnthropic(opts: {
  anthropicKey: string;
  systemPrompt: string;
  pastMessages: { role: string; content: string }[];
  userMessage: string;
  db: D1Database;
  githubToken: string;
  conversationId: string;
}): Promise<RunResult> {
  const { anthropicKey, systemPrompt, pastMessages, db, githubToken, conversationId } = opts;
  const client = new Anthropic({ apiKey: anthropicKey });

  const messages: Anthropic.MessageParam[] = pastMessages.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  let memoriesAdded = 0;
  let tasksUpdated = 0;

  while (true) {
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
          result = await executeTool(block.name as ToolName, block.input as Record<string, unknown>, { db, githubToken });
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

type AIMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string };
type WorkersAIResponse = { response?: string; tool_calls?: Array<{ name: string; arguments: Record<string, unknown> | string }> };

async function runWithWorkersAI(opts: {
  ai: Ai;
  systemPrompt: string;
  pastMessages: { role: string; content: string }[];
  db: D1Database;
  githubToken: string;
  conversationId: string;
}): Promise<RunResult> {
  const { ai, systemPrompt, pastMessages, db, githubToken, conversationId } = opts;

  const messages: AIMessage[] = [
    { role: 'system', content: systemPrompt },
    ...pastMessages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ];

  let memoriesAdded = 0;
  let tasksUpdated = 0;

  while (true) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (ai.run as any)('@cf/zai-org/glm-4.7-flash', {
      messages,
      tools: workerToolDefinitions,
      max_tokens: 4096,
    }) as WorkersAIResponse;

    const toolCalls = response.tool_calls;

    if (!toolCalls?.length) {
      const reply = response.response ?? '';
      await saveMessage(db, conversationId, 'assistant', reply);
      return { reply, memoriesAdded, tasksUpdated };
    }

    messages.push({ role: 'assistant', content: JSON.stringify(toolCalls) });

    for (const call of toolCalls) {
      const args = typeof call.arguments === 'string'
        ? JSON.parse(call.arguments) as Record<string, unknown>
        : call.arguments as Record<string, unknown>;
      let result: unknown;
      try {
        result = await executeTool(call.name as ToolName, args, { db, githubToken });
        if (call.name === 'memory_save') memoriesAdded++;
        if (call.name === 'wildock_task_update') tasksUpdated++;
      } catch (e) {
        result = { error: String(e) };
      }
      messages.push({ role: 'tool', content: JSON.stringify(result) });
    }
  }
}
