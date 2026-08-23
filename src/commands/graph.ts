import type { CommandModule } from 'yargs';
import { loadConfig } from '../config/loader';
import { createArchitecturePolicyGraph } from '../graph/policy';
import { emitOutput } from '../output';
import {
  renderArchitectureGraph,
  type GraphFormat
} from '../reporters/graph';
import { performAudit, DEFAULT_MAX_AUDIT_FILES } from './audit';
import { createActualArchitectureGraph } from '../graph/actual';

export interface GraphOptions {
  format?: GraphFormat;
  output?: string;
  configPath?: string;
  cwd?: string;
  actual?: boolean;
  revision?: string;
  maxFiles?: number;
}

export async function performGraph(opts: GraphOptions = {}): Promise<{ exitCode: number; error?: string }> {
  const cwd = opts.cwd || process.cwd();
  const configPath = opts.configPath || '.archguard.yml';
  try {
    const config = loadConfig(cwd, configPath);
    if (!config) return { exitCode: 2, error: `No ${configPath} found in current directory` };
    let graph;
    if (opts.actual) {
      const audit = await performAudit({
        revision: opts.revision,
        configPath,
        maxFiles: opts.maxFiles,
        cwd,
        noBaseline: true,
        emit: false
      });
      if (!audit.result) return { exitCode: 2, error: audit.error || 'Unable to audit repository' };
      graph = createActualArchitectureGraph(config, audit.result);
    } else {
      graph = createArchitecturePolicyGraph(config);
    }
    emitOutput(renderArchitectureGraph(graph, opts.format || 'pretty'), opts.output, cwd);
    return { exitCode: 0 };
  } catch (err) {
    return { exitCode: 2, error: (err as Error).message };
  }
}

export const graphCommand: CommandModule = {
  command: 'graph',
  describe: 'Render configured policy or actual repository architecture',
  builder: {
    format: {
      type: 'string',
      choices: ['pretty', 'json', 'mermaid', 'dot'],
      default: 'pretty',
      describe: 'Architecture graph format'
    },
    output: { type: 'string', describe: 'Write graph output to a file' },
    config: { type: 'string', describe: 'Path to the ArchGuard configuration file' },
    actual: { type: 'boolean', default: false, describe: 'Render observed repository dependencies' },
    revision: { type: 'string', default: 'HEAD', describe: 'Git revision for an actual graph' },
    'max-files': {
      type: 'number',
      default: DEFAULT_MAX_AUDIT_FILES,
      describe: 'Maximum supported source files for an actual graph'
    }
  },
  handler: async argv => {
    const result = await performGraph({
      format: argv.format as GraphFormat,
      output: argv.output as string | undefined,
      configPath: argv.config as string | undefined,
      actual: argv.actual as boolean,
      revision: argv.revision as string,
      maxFiles: argv.maxFiles as number
    });
    if (result.error) console.error(result.error);
    process.exit(result.exitCode);
  }
};
