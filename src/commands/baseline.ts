import fs from 'fs';
import type { CommandModule } from 'yargs';
import {
  baselineFinding,
  loadBaseline,
  resolveBaselineLocation,
  writeBaseline
} from '../baseline/store';
import type { ArchguardBaseline } from '../baseline/types';
import { loadConfig } from '../config/loader';
import { GitAdapterImpl } from '../git/GitAdapter';
import { performAudit } from './audit';

export type BaselineOperation = 'create' | 'update' | 'status';

export interface BaselineOptions {
  operation: BaselineOperation;
  revision?: string;
  output?: string;
  force?: boolean;
  configPath?: string;
  maxFiles?: number;
  cwd?: string;
  emit?: boolean;
}

export interface BaselineExecution {
  exitCode: number;
  error?: string;
  stats?: {
    stored: number;
    stillPresent: number;
    resolved: number;
    newViolations: number;
  };
}

export async function performBaseline(opts: BaselineOptions): Promise<BaselineExecution> {
  const cwd = opts.cwd || process.cwd();
  const shouldEmit = opts.emit !== false;

  try {
    const config = loadConfig(cwd, opts.configPath);
    if (!config) {
      return { exitCode: 2, error: `No ${opts.configPath || '.archguard.yml'} found in current directory` };
    }
    const git = new GitAdapterImpl(cwd);
    const repoRoot = await git.getRepositoryRoot();
    const location = resolveBaselineLocation(
      repoRoot,
      config,
      opts.operation === 'create' ? opts.output : undefined
    );

    if (opts.operation === 'create' && fs.existsSync(location.filePath) && !opts.force) {
      return {
        exitCode: 2,
        error: `Baseline already exists: ${location.filePath}. Use --force to replace it.`
      };
    }

    const storedBaseline = opts.operation === 'create'
      ? null
      : loadBaseline(location, true);
    const audit = await performAudit({
      revision: opts.revision,
      configPath: opts.configPath,
      maxFiles: opts.maxFiles,
      cwd,
      noBaseline: true,
      emit: false
    });
    if (!audit.result) return { exitCode: 2, error: audit.error || 'Unable to audit repository' };

    if (opts.operation === 'create') {
      const baseline: ArchguardBaseline = {
        version: 1,
        revision: audit.result.revision,
        createdAt: new Date().toISOString(),
        findings: audit.result.findings.map(baselineFinding)
      };
      writeBaseline(location.filePath, baseline);
      if (shouldEmit) {
        console.log(`ArchGuard baseline created with ${baseline.findings.length} finding(s).`);
        console.log(location.filePath);
      }
      return {
        exitCode: 0,
        stats: {
          stored: baseline.findings.length,
          stillPresent: baseline.findings.length,
          resolved: 0,
          newViolations: 0
        }
      };
    }

    const baseline = storedBaseline as ArchguardBaseline;
    const currentByFingerprint = new Map(
      audit.result.findings.map(finding => [finding.fingerprint, finding])
    );
    const storedFingerprints = new Set(
      baseline.findings.map(finding => finding.fingerprint)
    );
    const stillPresent = baseline.findings.filter(finding =>
      currentByFingerprint.has(finding.fingerprint)
    );
    const newFindings = audit.result.findings.filter(finding =>
      finding.fingerprint !== undefined && !storedFingerprints.has(finding.fingerprint)
    );
    const stats = {
      stored: baseline.findings.length,
      stillPresent: stillPresent.length,
      resolved: baseline.findings.length - stillPresent.length,
      newViolations: newFindings.length
    };

    if (opts.operation === 'update') {
      writeBaseline(location.filePath, {
        version: 1,
        revision: audit.result.revision,
        createdAt: new Date().toISOString(),
        findings: stillPresent
      });
      if (shouldEmit) {
        console.log('ArchGuard baseline updated.');
        console.log(`Still present: ${stats.stillPresent}`);
        console.log(`Resolved: ${stats.resolved}`);
        console.log(`New violations not added: ${stats.newViolations}`);
      }
      return { exitCode: 0, stats };
    }

    if (shouldEmit) {
      console.log('ArchGuard baseline');
      console.log('');
      console.log(`Stored findings: ${stats.stored}`);
      console.log(`Still present: ${stats.stillPresent}`);
      console.log(`Resolved: ${stats.resolved}`);
      console.log(`New violations: ${stats.newViolations}`);
    }
    return { exitCode: stats.newViolations > 0 ? 1 : 0, stats };
  } catch (err) {
    return { exitCode: 2, error: err instanceof Error ? err.message : String(err) };
  }
}

export const baselineCommand: CommandModule = {
  command: 'baseline <operation>',
  describe: 'Create, update, or inspect a repository architecture baseline',
  builder: yargs => yargs
    .positional('operation', {
      type: 'string',
      choices: ['create', 'update', 'status'] as const,
      describe: 'Baseline operation'
    })
    .option('revision', { type: 'string', default: 'HEAD', describe: 'Git revision to audit' })
    .option('output', { type: 'string', describe: 'Baseline path for create' })
    .option('force', { type: 'boolean', default: false, describe: 'Replace an existing baseline during create' })
    .option('config', { type: 'string', describe: 'Path to the ArchGuard configuration file' })
    .option('max-files', { type: 'number', describe: 'Maximum supported source files to audit' }),
  handler: async argv => {
    const execution = await performBaseline({
      operation: argv.operation as BaselineOperation,
      revision: argv.revision as string,
      output: argv.output as string | undefined,
      force: argv.force as boolean,
      configPath: argv.config as string | undefined,
      maxFiles: argv.maxFiles as number | undefined
    });
    if (execution.error) console.error(execution.error);
    process.exit(execution.exitCode);
  }
};
