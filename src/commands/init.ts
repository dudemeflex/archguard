import { CommandModule } from 'yargs';
import fs from 'fs';
import path from 'path';
import { sampleConfig } from '../config/sample';

export const initCommand: CommandModule = {
  command: 'init',
  describe: 'Create a .archguard.yml configuration file in the current directory',
  builder: {},
  handler: async (_argv) => {
    const target = path.resolve(process.cwd(), '.archguard.yml');
    if (fs.existsSync(target)) {
      console.error('.archguard.yml already exists in this directory. Aborting.');
      process.exit(2);
    }

    try {
      fs.writeFileSync(target, sampleConfig, { encoding: 'utf8', flag: 'wx' });
      console.log('Created .archguard.yml (schema version: 1)');
      process.exit(0);
    } catch (err) {
      const msg = err && (err as Error).message ? (err as Error).message : String(err);
      console.error('Failed to write .archguard.yml:', msg);
      process.exit(2);
    }
  }
};
