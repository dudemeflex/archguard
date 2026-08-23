import { runAction } from './run';

void runAction()
  .then(exitCode => {
    process.exitCode = exitCode;
  })
  .catch(err => {
    console.error(`ArchGuard: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 2;
  });
