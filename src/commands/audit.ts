import type { CommandModule } from 'yargs';
import { ArchitectureGraphImpl } from '../architecture/ArchitectureGraph';
import { collectLayerDependencies } from '../audit/layerDependencies';
import { selectAuditSourceFiles } from '../audit/sourceFiles';
import { applyBaseline, loadBaseline, resolveBaselineLocation } from '../baseline/store';
import { loadConfig } from '../config/loader';
import { TypeScriptDependencyAnalyzer } from '../dependencies/TypeScriptDependencyAnalyzer';
import { summarizeFindings } from '../findings/summary';
import { GitAdapterImpl } from '../git/GitAdapter';
import { ArchitectureImpactAnalyzer } from '../impact/ArchitectureImpactAnalyzer';
import { emitOutput } from '../output';
import { AuditTerminalReporter, renderAuditJson } from '../reporters/audit';
import { renderSarif } from '../reporters/sarif';
import { ArchitectureRuleEvaluator } from '../rules/ArchitectureRuleEvaluator';
import { CoverageRuleEvaluator } from '../rules/CoverageRuleEvaluator';
import type { AuditResult, RepositoryChange } from '../types';

export const DEFAULT_MAX_AUDIT_FILES = 20_000;
export type AuditFormat = 'pretty' | 'json' | 'sarif';

export interface AuditOptions {
  revision?: string;
  format?: AuditFormat;
  output?: string;
  configPath?: string;
  baselinePath?: string;
  noBaseline?: boolean;
  showBaseline?: boolean;
  maxFiles?: number;
  cwd?: string;
  emit?: boolean;
}

export interface AuditExecution {
  result?: AuditResult;
  exitCode: number;
  error?: string;
}

export async function performAudit(opts: AuditOptions = {}): Promise<AuditExecution> {
  const cwd = opts.cwd || process.cwd();
  const revision = opts.revision || 'HEAD';
  const format = opts.format || 'pretty';
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_AUDIT_FILES;
  const shouldEmit = opts.emit !== false;

  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1) {
    return { exitCode: 2, error: '--max-files must be a positive integer' };
  }
  if (opts.output && format !== 'json' && format !== 'sarif') {
    return { exitCode: 2, error: '--output is supported only with --format json or --format sarif' };
  }

  try {
    const config = loadConfig(cwd, opts.configPath);
    if (!config) {
      return { exitCode: 2, error: `No ${opts.configPath || '.archguard.yml'} found in current directory` };
    }

    const git = new GitAdapterImpl(cwd);
    const repoRoot = await git.getRepositoryRoot();
    const resolvedRevision = await git.resolveRevision(revision);
    const trackedFiles = await git.listFilesAtRevision(revision);
    const sourceFiles = selectAuditSourceFiles(trackedFiles, config.audit?.exclude || []);
    if (sourceFiles.length > maxFiles) {
      return {
        exitCode: 2,
        error: `Audit exceeds maximum source-file limit: ${sourceFiles.length} > ${maxFiles}`
      };
    }

    const analyzer = new TypeScriptDependencyAnalyzer({ repoRoot, gitAdapter: git });
    const dependencyGraph = await analyzer.analyze(sourceFiles, resolvedRevision);
    const architecture = new ArchitectureGraphImpl(config);
    const auditChanges: RepositoryChange[] = sourceFiles.map(file => ({
      type: 'modified',
      path: file
    }));
    const impact = new ArchitectureImpactAnalyzer(architecture)
      .analyze(auditChanges, dependencyGraph);
    const dependencyFindings = await new ArchitectureRuleEvaluator(architecture)
      .evaluate(dependencyGraph, config);
    const coverageFindings = new CoverageRuleEvaluator().evaluate(impact, {
      requireMappedChangedFiles: config.coverage?.requireMappedChangedFiles || false,
      forbidOverlappingLayers: config.coverage?.forbidOverlappingLayers || false,
      scope: 'audited'
    });
    const rawFindings = [...dependencyFindings, ...coverageFindings];
    const baseline = opts.noBaseline
      ? null
      : loadBaseline(resolveBaselineLocation(repoRoot, config, opts.baselinePath));
    const findings = applyBaseline(rawFindings, baseline);
    const layerDependencies = collectLayerDependencies(dependencyGraph, architecture, config);
    const summary = summarizeFindings(findings);
    const result: AuditResult = {
      revision: resolvedRevision,
      dependencyGraph,
      findings,
      impact,
      layerDependencies,
      stats: {
        filesAudited: sourceFiles.length,
        edgesAnalyzed: Object.values(dependencyGraph)
          .reduce((total, edges) => total + edges.length, 0),
        layersUsed: impact.layersTouched.length
      },
      summary
    };

    if (shouldEmit) {
      if (opts.output) {
        emitOutput(format === 'sarif' ? renderSarif(result) : renderAuditJson(result), opts.output, cwd);
      } else if (format === 'json') {
        console.log(renderAuditJson(result));
      } else if (format === 'sarif') {
        console.log(renderSarif(result));
      } else {
        await new AuditTerminalReporter({ showBaseline: opts.showBaseline }).report(result);
      }
    }

    return { result, exitCode: summary.errors > 0 ? 1 : 0 };
  } catch (err) {
    return { exitCode: 2, error: err instanceof Error ? err.message : String(err) };
  }
}

export const auditCommand: CommandModule = {
  command: 'audit',
  describe: 'Audit all tracked JavaScript and TypeScript source files at a Git revision',
  builder: {
    revision: { type: 'string', default: 'HEAD', describe: 'Git revision to audit' },
    format: {
      type: 'string',
      choices: ['pretty', 'json', 'sarif'],
      default: 'pretty',
      describe: 'Output format'
    },
    output: { type: 'string', describe: 'Write JSON or SARIF output to a file' },
    config: { type: 'string', describe: 'Path to the ArchGuard configuration file' },
    'max-files': {
      type: 'number',
      default: DEFAULT_MAX_AUDIT_FILES,
      describe: 'Maximum supported source files to audit'
    },
    baseline: { type: 'boolean', default: true, describe: 'Use the configured or discovered baseline' },
    'show-baseline': { type: 'boolean', default: false, describe: 'Show suppressed findings in pretty output' }
  },
  handler: async argv => {
    const execution = await performAudit({
      revision: argv.revision as string,
      format: argv.format as AuditFormat,
      output: argv.output as string | undefined,
      configPath: argv.config as string | undefined,
      maxFiles: argv.maxFiles as number,
      noBaseline: argv.baseline === false,
      showBaseline: argv.showBaseline as boolean
    });
    if (execution.error) console.error(execution.error);
    process.exit(execution.exitCode);
  }
};
