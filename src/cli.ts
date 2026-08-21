import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { initCommand } from './commands/init';
import { scanCommand } from './commands/scan';

const argv = yargs(hideBin(process.argv))
  .scriptName('archguard')
  .usage('$0 <cmd> [args]')
  .command(initCommand)
  .command(scanCommand)
  .help()
  .wrap(Math.min(100, process.stdout.columns || 80))
  .epilog('Archguard is under active development. Scanning is experimental.')
  .parse();

export default argv;
