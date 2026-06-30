import type Anthropic from '@anthropic-ai/sdk';
import { saveMemory, updateMemory, searchMemories, upsertWildockTask, getOpenWildockTasks, getBriefs } from '../memory/store';

export type ToolName =
  | 'memory_save'
  | 'memory_update'
  | 'memory_search'
  | 'wildock_task_update'
  | 'wildock_tasks_list'
  | 'viibeu_briefs_list'
  | 'github_read_file'
  | 'github_create_pr'
  | 'self_read_file'
  | 'self_write_file'
  | 'self_deploy';

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: 'memory_save',
    description: 'Save a fact, preference, decision, or note to long-term memory. Use whenever Ido shares something worth remembering across sessions.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['fact', 'preference', 'decision', 'task', 'note'] },
        project: { type: 'string', enum: ['wildock', 'viibeu', 'myassistance', 'general'] },
        content: { type: 'string', description: 'The memory content — be specific and self-contained' },
        tags: { type: 'string', description: 'Comma-separated tags for searchability' },
      },
      required: ['type', 'content'],
    },
  },
  {
    name: 'memory_update',
    description: 'Update an existing memory by ID when a fact or decision has changed.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['id', 'content'],
    },
  },
  {
    name: 'memory_search',
    description: 'Search long-term memory for context relevant to the current conversation.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        project: { type: 'string', enum: ['wildock', 'viibeu', 'myassistance', 'general'] },
      },
      required: ['query'],
    },
  },
  {
    name: 'wildock_task_update',
    description: 'Update or create a Wildock task (from ROADMAP.md). Use when starting, finishing, or noting context on a task.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task ID e.g. FIX-FE-012 or FEAT-P1-003' },
        title: { type: 'string' },
        type: { type: 'string', enum: ['fix', 'feature', 'prod'] },
        status: { type: 'string', enum: ['open', 'in_progress', 'done', 'cancelled'] },
        phase: { type: 'string', description: 'phase1 | phase2 | phase3 — for features only' },
        notes: { type: 'string', description: 'Decisions or context on this task' },
      },
      required: ['id', 'title', 'type', 'status'],
    },
  },
  {
    name: 'wildock_tasks_list',
    description: 'List all open or in-progress Wildock tasks.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'viibeu_briefs_list',
    description: 'List viibeu client briefs, optionally filtered by status.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['new', 'reviewed', 'in_progress', 'delivered', 'cancelled'] },
      },
      required: [],
    },
  },
  {
    name: 'github_read_file',
    description: 'Read a file from the Wildock or viibeu GitHub repository.',
    input_schema: {
      type: 'object',
      properties: {
        repo: { type: 'string', enum: ['wildock', 'viibeu'], description: 'Which repo to read from' },
        path: { type: 'string', description: 'File path relative to repo root e.g. Mdfiles/ROADMAP.md' },
      },
      required: ['repo', 'path'],
    },
  },
  {
    name: 'self_read_file',
    description: 'Read a file from the MyAssistance repo (your own source code). Always read before writing to get current content and SHA.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to repo root e.g. src/tools/index.ts' },
      },
      required: ['path'],
    },
  },
  {
    name: 'self_write_file',
    description: 'Commit a file change directly to the MyAssistance main branch (your own code). Read the file first to get current SHA. After all writes are done, call self_deploy.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to repo root' },
        content: { type: 'string', description: 'Full new file content' },
        message: { type: 'string', description: 'Commit message' },
        sha: { type: 'string', description: 'Current file SHA from self_read_file (required for updates, omit for new files)' },
      },
      required: ['path', 'content', 'message'],
    },
  },
  {
    name: 'self_deploy',
    description: 'Trigger a GitHub Actions deploy workflow to rebuild and redeploy the MyAssistance Worker. Call after committing code changes via self_write_file.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'github_create_pr',
    description: 'Create a pull request in Wildock or viibeu with file changes.',
    input_schema: {
      type: 'object',
      properties: {
        repo: { type: 'string', enum: ['wildock', 'viibeu'] },
        branch: { type: 'string', description: 'New branch name' },
        title: { type: 'string' },
        body: { type: 'string' },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['path', 'content'],
          },
          description: 'Files to create or update',
        },
      },
      required: ['repo', 'branch', 'title', 'body', 'files'],
    },
  },
];

// Workers AI format (OpenAI-compatible) — derived from toolDefinitions
export const workerToolDefinitions = toolDefinitions.map(t => ({
  type: 'function' as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  },
}));

// ── Tool execution ────────────────────────────────────────────

interface ToolContext {
  db: D1Database;
  githubToken: string;
  cfAccountId?: string;
  cfWorkersToken?: string;
  cfZonesToken?: string;
  cfAccessToken?: string;
}

const REPOS: Record<string, string> = {
  wildock: 'ido-sender-p/Wildock',
  viibeu: 'ido-sender-p/viibeu',
};

export async function executeTool(
  name: ToolName,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<unknown> {
  switch (name) {
    case 'memory_save': {
      const id = await saveMemory(ctx.db, {
        type: input.type as never,
        project: (input.project as never) ?? null,
        content: input.content as string,
        tags: (input.tags as string) ?? null,
      });
      return { ok: true, id };
    }

    case 'memory_update': {
      await updateMemory(ctx.db, input.id as string, input.content as string);
      return { ok: true };
    }

    case 'memory_search': {
      const results = await searchMemories(ctx.db, input.query as string, input.project as never);
      return results;
    }

    case 'wildock_task_update': {
      await upsertWildockTask(ctx.db, {
        id: input.id as string,
        title: input.title as string,
        type: input.type as never,
        status: input.status as string,
        phase: input.phase as string | undefined,
        notes: input.notes as string | undefined,
      });
      return { ok: true };
    }

    case 'wildock_tasks_list': {
      return await getOpenWildockTasks(ctx.db);
    }

    case 'viibeu_briefs_list': {
      return await getBriefs(ctx.db, input.status as string | undefined);
    }

    case 'github_read_file': {
      const repo = REPOS[input.repo as string];
      const res = await fetch(`https://api.github.com/repos/${repo}/contents/${input.path}`, {
        headers: {
          Authorization: `Bearer ${ctx.githubToken}`,
          Accept: 'application/vnd.github.v3.raw',
        },
      });
      if (!res.ok) throw new Error(`GitHub ${res.status}: ${input.path}`);
      return { content: await res.text() };
    }

    case 'self_read_file': {
      const res = await fetch(
        `https://api.github.com/repos/ido-sender-p/MyAssistance/contents/${input.path}`,
        { headers: { Authorization: `Bearer ${ctx.githubToken}`, Accept: 'application/vnd.github.v3+json' } }
      );
      if (!res.ok) throw new Error(`GitHub ${res.status}: ${input.path}`);
      const data = await res.json() as { content: string; sha: string; encoding: string };
      const content = data.encoding === 'base64'
        ? decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))))
        : data.content;
      return { content, sha: data.sha };
    }

    case 'self_write_file': {
      const body: Record<string, string> = {
        message: input.message as string,
        content: btoa(unescape(encodeURIComponent(input.content as string))),
        branch: 'main',
      };
      if (input.sha) body.sha = input.sha as string;

      const res = await fetch(
        `https://api.github.com/repos/ido-sender-p/MyAssistance/contents/${input.path}`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${ctx.githubToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`GitHub ${res.status}: ${err}`);
      }
      const data = await res.json() as { commit: { sha: string } };
      return { ok: true, commitSha: data.commit.sha };
    }

    case 'self_deploy': {
      const res = await fetch(
        'https://api.github.com/repos/ido-sender-p/MyAssistance/actions/workflows/deploy.yml/dispatches',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${ctx.githubToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ref: 'main' }),
        }
      );
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Deploy trigger failed ${res.status}: ${err}`);
      }
      return { ok: true, message: 'Deploy workflow triggered. Will be live in ~1 minute.' };
    }

    case 'github_create_pr': {
      const repo = REPOS[input.repo as string];
      const files = input.files as Array<{ path: string; content: string }>;
      const branch = input.branch as string;

      // get default branch SHA
      const repoRes = await fetch(`https://api.github.com/repos/${repo}`, {
        headers: { Authorization: `Bearer ${ctx.githubToken}` },
      });
      const repoData = await repoRes.json() as { default_branch: string };
      const defaultBranch = repoData.default_branch;

      const refRes = await fetch(`https://api.github.com/repos/${repo}/git/ref/heads/${defaultBranch}`, {
        headers: { Authorization: `Bearer ${ctx.githubToken}` },
      });
      const refData = await refRes.json() as { object: { sha: string } };
      const sha = refData.object.sha;

      // create branch
      await fetch(`https://api.github.com/repos/${repo}/git/refs`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ctx.githubToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
      });

      // commit each file
      for (const file of files) {
        const encoded = btoa(unescape(encodeURIComponent(file.content)));
        await fetch(`https://api.github.com/repos/${repo}/contents/${file.path}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${ctx.githubToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: `chore: ${file.path}`, content: encoded, branch }),
        });
      }

      // open PR
      const prRes = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ctx.githubToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: input.title, body: input.body, head: branch, base: defaultBranch }),
      });
      const pr = await prRes.json() as { html_url: string };
      return { url: pr.html_url };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
