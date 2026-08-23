import fs from 'fs';

export interface ActionRefs {
  base: string;
  head: string;
}

interface PullRequestPayload {
  pull_request?: {
    base?: { sha?: unknown };
    head?: { sha?: unknown };
  };
}

function value(input: string | undefined): string | undefined {
  const trimmed = input?.trim();
  return trimmed || undefined;
}

function pullRequestRefs(
  eventPath: string | undefined,
  readFile: (path: string) => string
): Partial<ActionRefs> {
  if (!eventPath) return {};

  let payload: PullRequestPayload;
  try {
    payload = JSON.parse(readFile(eventPath)) as PullRequestPayload;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Unable to read GitHub event payload: ${message}`);
  }

  const base = typeof payload.pull_request?.base?.sha === 'string'
    ? value(payload.pull_request.base.sha)
    : undefined;
  const head = typeof payload.pull_request?.head?.sha === 'string'
    ? value(payload.pull_request.head.sha)
    : undefined;
  return { ...(base ? { base } : {}), ...(head ? { head } : {}) };
}

export function resolveActionRefs(
  env: NodeJS.ProcessEnv = process.env,
  readFile: (path: string) => string = path => fs.readFileSync(path, 'utf8')
): ActionRefs {
  const inputBase = value(env.INPUT_BASE);
  const inputHead = value(env.INPUT_HEAD);
  const eventRefs = inputBase && inputHead
    ? {}
    : pullRequestRefs(value(env.GITHUB_EVENT_PATH), readFile);
  const base = inputBase || eventRefs.base || value(env.GITHUB_BASE_REF);
  const head = inputHead || eventRefs.head || value(env.GITHUB_SHA) || value(env.GITHUB_HEAD_REF) || 'HEAD';

  if (!base) {
    throw new Error(
      'Unable to determine the base revision. Set the action base input or run on a pull_request event.'
    );
  }

  return { base, head };
}
