import type { CommandModule } from 'yargs';
import { loadConfig } from '../config/loader';
import { GitAdapterImpl } from '../git/GitAdapter';
import { TypeScriptDependencyAnalyzer } from '../dependencies/TypeScriptDependencyAnalyzer';
import { ArchitectureRuleEvaluator } from '../rules/ArchitectureRuleEvaluator';
import { CompanionChangeEvaluator } from '../rules/CompanionChangeEvaluator';
import { CoverageRuleEvaluator } from '../rules/CoverageRuleEvaluator';
import { ArchitectureGraphImpl } from '../architecture/ArchitectureGraph';
import { ArchitectureImpactAnalyzer } from '../impact/ArchitectureImpactAnalyzer';
import { TerminalReporter } from '../reporters';
import { JsonReporter, renderJson } from '../reporters/json';
import { GithubReporter } from '../reporters/github';
import { SarifReporter, renderSarif } from '../reporters/sarif';
import type { Finding } from '../finding';
import type { ArchitectureImpact, DependencyGraph, ScanResult } from '../types';
import { isSupportedSourcePath } from '../sourceFiles';
import { emitOutput } from '../output';

export type ScanFormat = 'pretty' | 'json' | 'github' | 'sarif';

export interface ScanOptions {
  base: string;
  head?: string;
  format?: ScanFormat;
  output?: string;
  configPath?: string;
  strict?: boolean;
  impact?: boolean;
  cwd?: string;
}

export async function performScan(opts: ScanOptions): Promise<{ result?: ScanResult; exitCode: number; error?: string }> {
  const cwd = opts.cwd || process.cwd();
  const base = opts.base;
  const head = opts.head || 'HEAD';
  const format = opts.format || 'pretty';

  if (!base) return { exitCode: 2, error: 'Missing required --base argument' };
  if (opts.output && format !== 'json' && format !== 'sarif') {
    return { exitCode: 2, error: '--output is supported only with --format json or --format sarif' };
  }

  let cfg;
  try {
    cfg = loadConfig(cwd, opts.configPath);
  } catch (err) {
    return { exitCode: 2, error: (err as Error).message };
  }
  if (!cfg) {
    return { exitCode: 2, error: `No ${opts.configPath || '.archguard.yml'} found in current directory` };
  }

  const git = new GitAdapterImpl(cwd);
  let changes;
  try {
    changes = await git.getChanges(base, head);
  } catch (err) {
    return { exitCode: 2, error: (err as Error).message };
  }

  const relevantFiles = changes
    .filter(change => change.type !== 'deleted')
    .map(change => change.path)
    .filter(filePath => isSupportedSourcePath(filePath));

  let dependencyGraph: DependencyGraph = {};
  try {
    const repoRoot = await git.getRepositoryRoot();
    const analyzer = new TypeScriptDependencyAnalyzer({ repoRoot, gitAdapter: git });
    dependencyGraph = await analyzer.analyze(relevantFiles, head);
  } catch (err) {
    return { exitCode: 2, error: (err as Error).message };
  }

  let findings: Finding[];
  let impact: ArchitectureImpact;
  try {
    const architecture = new ArchitectureGraphImpl(cfg);
    impact = new ArchitectureImpactAnalyzer(architecture).analyze(changes, dependencyGraph);
    const dependencyFindings = await new ArchitectureRuleEvaluator(architecture)
      .evaluate(dependencyGraph, cfg);
    const companionFindings = new CompanionChangeEvaluator(cfg, architecture).evaluate(changes);
    const coveragePolicy = {
      requireMappedChangedFiles: opts.strict || cfg.coverage?.requireMappedChangedFiles || false,
      forbidOverlappingLayers: opts.strict || cfg.coverage?.forbidOverlappingLayers || false
    };
    const coverageFindings = new CoverageRuleEvaluator().evaluate(impact, coveragePolicy);
    findings = [...dependencyFindings, ...companionFindings, ...coverageFindings];
  } catch (err) {
    return { exitCode: 2, error: (err as Error).message };
  }

  const summary = { errors: 0, warnings: 0, info: 0 };
  for (const finding of findings) {
    if (finding.severity === 'error') summary.errors++;
    else if (finding.severity === 'warning') summary.warnings++;
    else summary.info++;
  }

  const result: ScanResult = {
    comparison: { base, head },
    findings,
    changes,
    dependencyGraph,
    impact,
    stats: {
      changedFiles: changes.length,
      filesAnalyzed: Object.keys(dependencyGraph).length,
      edgesAnalyzed: Object.values(dependencyGraph).reduce((sum, edges) => sum + edges.length, 0)
    },
    summary
  };

  try {
    if (opts.output) {
      const rendered = format === 'sarif' ? renderSarif(result) : renderJson(result);
      emitOutput(rendered, opts.output, cwd);
    } else if (format === 'json') {
      await new JsonReporter().report(result);
    } else if (format === 'sarif') {
      await new SarifReporter().report(result);
    } else if (format === 'github') {
      await new GithubReporter().report(result);
    } else {
      await new TerminalReporter({ detailedImpact: opts.impact }).report(result);
    }
  } catch (err) {
    return { exitCode: 2, error: (err as Error).message };
  }

  return { result, exitCode: summary.errors > 0 ? 1 : 0 };
}

export const scanCommand: CommandModule = {
  command: 'scan',
  describe: 'Scan changed source files against architecture policy',
  builder: {
    base: { type: 'string', demandOption: false, describe: 'Git base revision' },
    head: { type: 'string', demandOption: false, describe: 'Git head revision (default: HEAD)' },
    format: { type: 'string', choices: ['pretty', 'json', 'github', 'sarif'], default: 'pretty', describe: 'Output format' },
    output: { type: 'string', describe: 'Write JSON or SARIF output to a file' },
    strict: { type: 'boolean', default: false, describe: 'Require mapped files and exclusive layer matches for this scan' },
    impact: { type: 'boolean', default: false, describe: 'Show detailed architecture impact in pretty output' }
  },
  handler: async (argv) => {
    const base = argv.base as string | undefined;
    const head = (argv.head as string | undefined) || 'HEAD';
    const format = argv.format as ScanFormat;
    const output = argv.output as string | undefined;
    const strict = argv.strict as boolean;
    const impact = argv.impact as boolean;

    if (!base) {
      console.error('Missing required --base argument');
      process.exit(2);
    }

    const { exitCode, error } = await performScan({ base, head, format, output, strict, impact });
    if (error) {
      console.error(error);
    }
    process.exit(exitCode);
  }
};
