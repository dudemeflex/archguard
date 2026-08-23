import type { CommandModule } from 'yargs';
import { loadConfig } from '../config/loader';

export interface ValidateOptions {
  configPath?: string;
  cwd?: string;
}

export function performValidate(opts: ValidateOptions = {}): { exitCode: number; error?: string } {
  const cwd = opts.cwd || process.cwd();
  const configPath = opts.configPath || '.archguard.yml';
  try {
    const config = loadConfig(cwd, configPath);
    if (!config) return { exitCode: 2, error: `No ${configPath} found in current directory` };
    return { exitCode: 0 };
  } catch (err) {
    return { exitCode: 2, error: (err as Error).message };
  }
}

export const validateCommand: CommandModule = {
  command: 'validate',
  describe: 'Validate an ArchGuard configuration without scanning Git history',
  builder: {
    config: { type: 'string', describe: 'Path to the ArchGuard configuration file' }
  },
  handler: async argv => {
    const result = performValidate({ configPath: argv.config as string | undefined });
    if (result.error) console.error(result.error);
    else console.log('ArchGuard configuration is valid.');
    process.exit(result.exitCode);
  }
};
