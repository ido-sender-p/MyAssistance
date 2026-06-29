import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt } from './config/prompts';
import { toolDefinitions, executeTool, type ToolName } from './tools/index';
import {
  getMemories,
  formatMemoriesForPrompt,
  saveMessage,
  getRecentMessages,
} from './memory/store';

interface RunOptions {
  db: D1Database;
  githubToken: string;
  anthropicKey: string;
  conversationId: string;
  userMessage: string;
}

export interface RunResult {
  reply: string;
  memoriesAdded: number;
  tasksUpdated: number;
}

export async function runAssistant(opts: RunOptions): Promise<RunResult> {
  const { db, githubToken, anthropicKey, conversationId, userMessage } = opts;

  const client = new Anthropic({ apiKey: anthropicKey });

  const memories = await getMemories(db);
  const systemPrompt = buildSystemPrompt(formatMemoriesForPrompt(memories));

  await saveMessage(db, conversationId, 'user', userMessage);

  const history = await getRecentMessages(db, conversationId, 20);

  const messages: Anthropic.MessageParam[] = history
    .filter(m => m.role !== 'tool')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

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

        const toolName = block.name as ToolName;
        let result: unknown;

        try {
          result = await executeTool(
            toolName,
            block.input as Record<string, unknown>,
            { db, githubToken }
          );
          if (toolName === 'memory_save') memoriesAdded++;
          if (toolName === 'wildock_task_update') tasksUpdated++;
        } catch (e) {
          result = { error: String(e) };
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    break;
  }

  return { reply: 'Error: unexpected loop exit', memoriesAdded, tasksUpdated };
}
