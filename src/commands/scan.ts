import { CommandModule } from 'yargs';

export function scanNotImplemented() {
  return {
    code: 2,
    message: 'Scan is not implemented yet. Expected flow: collect git changes → build dependency graph → evaluate rules → report findings.'
  } as const;
}

export const scanCommand: CommandModule = {
  command: 'scan',
  describe: 'Run an architecture scan (experimental)',
  handler: async () => {
    const info = scanNotImplemented();
    console.error(info.message);
    process.exit(info.code);
  }
};
