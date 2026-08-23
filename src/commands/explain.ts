import type { CommandModule } from 'yargs';
import { ArchitectureGraphImpl } from '../architecture/ArchitectureGraph';
import { normalizeRepositoryPath } from '../architecture/globs';
import { loadConfig } from '../config/loader';
import {
  evaluateLayerDependency,
  type ArchitectureDecisionReason
} from '../rules/architecturePolicy';

export type ExplainFormat = 'pretty' | 'json';

export interface ExplainEvaluation {
  from: string;
  to: string;
  allowed: boolean;
  reason: ArchitectureDecisionReason;
  rule?: string;
}

export interface ExplainResult {
  source: { path: string; layers: string[] };
  target: { path: string; layers: string[] };
  evaluations: ExplainEvaluation[];
  allowed: boolean | null;
}

export interface ExplainOptions {
  source: string;
  target: string;
  format?: ExplainFormat;
  configPath?: string;
  cwd?: string;
  emit?: boolean;
}

function mappedLayerLines(layers: string[]): string[] {
  return layers.length > 0 ? layers.map(layer => `  ${layer}`) : ['  (none)'];
}

export function renderExplainPretty(result: ExplainResult): string {
  const lines = [
    'ArchGuard explanation',
    '',
    'Source:',
    `  ${result.source.path}`,
    '',
    'Mapped layers:',
    ...mappedLayerLines(result.source.layers),
    '',
    'Target:',
    `  ${result.target.path}`,
    '',
    'Mapped layers:',
    ...mappedLayerLines(result.target.layers),
    ''
  ];

  if (result.allowed === null) {
    lines.push(
      'Decision:',
      '  NOT EVALUATED',
      '',
      'Reason:',
      '  Architecture dependency rules apply only when both paths map to a layer.'
    );
    return lines.join('\n');
  }

  lines.push('Evaluations:');
  for (const evaluation of result.evaluations) {
    lines.push(
      `  ${evaluation.from} -> ${evaluation.to}   ${evaluation.allowed ? 'ALLOWED' : 'FORBIDDEN'}`
    );
    if (evaluation.reason === 'explicitRule') {
      lines.push(
        `    Rule: ${evaluation.rule}`,
        '    Reason: Explicit rule overrides layer mayDependOn policy.'
      );
    } else if (evaluation.reason === 'sameLayer') {
      lines.push(
        '    Rule: default same-layer policy',
        '    Reason: Same-layer dependencies are allowed unless an explicit rule overrides them.'
      );
    } else {
      lines.push(
        '    Rule: default mayDependOn policy',
        `    Reason: Layer "${evaluation.from}" ${evaluation.allowed ? 'allows' : 'does not allow'} `
          + `dependencies on layer "${evaluation.to}".`
      );
    }
  }
  lines.push('', 'Decision:', `  ${result.allowed ? 'ALLOWED' : 'FORBIDDEN'}`);
  return lines.join('\n');
}

export function renderExplainJson(result: ExplainResult): string {
  return JSON.stringify(result, null, 2);
}

export function performExplain(opts: ExplainOptions): {
  result?: ExplainResult;
  exitCode: number;
  error?: string;
} {
  const cwd = opts.cwd || process.cwd();
  try {
    const config = loadConfig(cwd, opts.configPath);
    if (!config) {
      return { exitCode: 2, error: `No ${opts.configPath || '.archguard.yml'} found in current directory` };
    }
    const sourcePath = normalizeRepositoryPath(opts.source);
    const targetPath = normalizeRepositoryPath(opts.target);
    const architecture = new ArchitectureGraphImpl(config);
    const sourceLayers = architecture.fileToLayers(sourcePath);
    const targetLayers = architecture.fileToLayers(targetPath);
    const evaluations: ExplainEvaluation[] = [];
    for (const from of sourceLayers) {
      for (const to of targetLayers) {
        const decision = evaluateLayerDependency(config, from, to);
        evaluations.push({
          from,
          to,
          allowed: decision.allowed,
          reason: decision.reason,
          ...(decision.ruleName ? { rule: decision.ruleName } : {})
        });
      }
    }
    const result: ExplainResult = {
      source: { path: sourcePath, layers: sourceLayers },
      target: { path: targetPath, layers: targetLayers },
      evaluations,
      allowed: evaluations.length === 0
        ? null
        : evaluations.every(evaluation => evaluation.allowed)
    };
    if (opts.emit !== false) {
      console.log(opts.format === 'json' ? renderExplainJson(result) : renderExplainPretty(result));
    }
    return { result, exitCode: 0 };
  } catch (err) {
    return { exitCode: 2, error: err instanceof Error ? err.message : String(err) };
  }
}

export const explainCommand: CommandModule = {
  command: 'explain <source> <target>',
  describe: 'Explain how architecture policy evaluates a source and target path',
  builder: {
    source: { type: 'string', demandOption: true, describe: 'Repository-relative source path' },
    target: { type: 'string', demandOption: true, describe: 'Repository-relative target path' },
    format: { type: 'string', choices: ['pretty', 'json'], default: 'pretty', describe: 'Output format' },
    config: { type: 'string', describe: 'Path to the ArchGuard configuration file' }
  },
  handler: argv => {
    const execution = performExplain({
      source: argv.source as string,
      target: argv.target as string,
      format: argv.format as ExplainFormat,
      configPath: argv.config as string | undefined
    });
    if (execution.error) console.error(execution.error);
    process.exit(execution.exitCode);
  }
};
