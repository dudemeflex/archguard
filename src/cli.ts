import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { initCommand } from './commands/init';
import { scanCommand } from './commands/scan';
import { graphCommand } from './commands/graph';
import { validateCommand } from './commands/validate';
import { auditCommand } from './commands/audit';
import { baselineCommand } from './commands/baseline';
import { explainCommand } from './commands/explain';

const argv = yargs(hideBin(process.argv))
  .scriptName('archguard')
  .usage('$0 <cmd> [args]')
  .command(initCommand)
  .command(scanCommand)
  .command(validateCommand)
  .command(graphCommand)
  .command(auditCommand)
  .command(baselineCommand)
  .command(explainCommand)
  .help()
  .wrap(Math.min(100, process.stdout.columns || 80))
  .epilog('ArchGuard protects architecture, not style.')
  .parse();

export default argv;
