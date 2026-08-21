import { CommandModule } from 'yargs';
import { loadConfig } from '../config/loader';
import { GitAdapterImpl } from '../git/GitAdapter';
import { TerminalReporter } from '../reporters';
import { JsonReporter } from '../reporters/json';
import type { ScanResult } from '../types';

export async function performScan(opts: { base: string; head?: string; format?: 'pretty' | 'json'; cwd?: string }): Promise<{ result?: ScanResult; exitCode: number; error?: string }> {
  const cwd = opts.cwd || process.cwd();
  const base = opts.base;
  const head = opts.head || 'HEAD';
  const format = opts.format || 'pretty';

  if (!base) return { exitCode: 2, error: 'Missing required --base argument' };

  // Load config and validate
  let cfg;
  try {
    cfg = loadConfig(cwd);
  } catch (err) {
    return { exitCode: 2, error: (err as Error).message };
  }
  if (!cfg) {
    return { exitCode: 2, error: 'No .archguard.yml found in current directory' };
  }

  const git = new GitAdapterImpl(cwd);
  let changes;
  try {
    changes = await git.getChanges(base, head);
  } catch (err) {
    return { exitCode: 2, error: (err as Error).message };
  }

  const result: ScanResult = {
    comparison: { base, head },
    findings: [],
    changes,
    stats: { filesAnalyzed: changes.length }
  };

  try {
    if (format === 'json') {
      const jr = new JsonReporter();
      await jr.report(result);
    } else {
      const tr = new TerminalReporter();
      await tr.report(result);
    }
  } catch (err) {
    return { exitCode: 2, error: (err as Error).message };
  }

  return { result, exitCode: 0 };
}

export const scanCommand: CommandModule = {
  command: 'scan',
  describe: 'Run an architecture scan (experimental)',
  builder: {
    base: { type: 'string', demandOption: false, describe: 'Git base revision' },
    head: { type: 'string', demandOption: false, describe: 'Git head revision (default: HEAD)' },
    format: { type: 'string', choices: ['pretty', 'json'], default: 'pretty', describe: 'Output format' }
  },
  handler: async (argv) => {
    const base = argv.base as string | undefined;
    const head = (argv.head as string | undefined) || 'HEAD';
    const format = argv.format as 'pretty' | 'json';

    if (!base) {
      console.error('Missing required --base argument');
      process.exit(2);
    }

    const { exitCode, error } = await performScan({ base, head, format });
    if (error) {
      console.error(error);
    }
    process.exit(exitCode);
  }
};
