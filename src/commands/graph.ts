import type { CommandModule } from 'yargs';
import { loadConfig } from '../config/loader';
import { createArchitecturePolicyGraph } from '../graph/policy';
import { emitOutput } from '../output';
import {
  renderArchitectureGraph,
  type GraphFormat
} from '../reporters/graph';

export interface GraphOptions {
  format?: GraphFormat;
  output?: string;
  configPath?: string;
  cwd?: string;
}

export function performGraph(opts: GraphOptions = {}): { exitCode: number; error?: string } {
  const cwd = opts.cwd || process.cwd();
  const configPath = opts.configPath || '.archguard.yml';
  try {
    const config = loadConfig(cwd, configPath);
    if (!config) return { exitCode: 2, error: `No ${configPath} found in current directory` };
    const graph = createArchitecturePolicyGraph(config);
    emitOutput(renderArchitectureGraph(graph, opts.format || 'pretty'), opts.output, cwd);
    return { exitCode: 0 };
  } catch (err) {
    return { exitCode: 2, error: (err as Error).message };
  }
}

export const graphCommand: CommandModule = {
  command: 'graph',
  describe: 'Render the configured architecture policy without scanning a diff',
  builder: {
    format: {
      type: 'string',
      choices: ['pretty', 'json', 'mermaid', 'dot'],
      default: 'pretty',
      describe: 'Architecture graph format'
    },
    output: { type: 'string', describe: 'Write graph output to a file' },
    config: { type: 'string', describe: 'Path to the ArchGuard configuration file' }
  },
  handler: async argv => {
    const result = performGraph({
      format: argv.format as GraphFormat,
      output: argv.output as string | undefined,
      configPath: argv.config as string | undefined
    });
    if (result.error) console.error(result.error);
    process.exit(result.exitCode);
  }
};
