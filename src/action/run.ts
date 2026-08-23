import { performScan } from '../commands/scan';
import { resolveActionRefs } from './context';
import { appendStepSummary } from './summary';

export async function runAction(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  let refs;
  try {
    refs = resolveActionRefs(env);
  } catch (err) {
    console.error(`ArchGuard: ${(err as Error).message}`);
    return 2;
  }

  const workspace = env.GITHUB_WORKSPACE || process.cwd();
  const configPath = env.INPUT_CONFIG?.trim() || '.archguard.yml';
  const baselinePath = env.INPUT_BASELINE?.trim() || undefined;
  const noBaseline = env['INPUT_IGNORE-BASELINE']?.trim().toLowerCase() === 'true';
  const scan = await performScan({
    base: refs.base,
    head: refs.head,
    format: 'github',
    configPath,
    baselinePath,
    noBaseline,
    cwd: workspace
  });

  if (scan.error) console.error(`ArchGuard: ${scan.error}`);

  if (scan.result && env.GITHUB_STEP_SUMMARY) {
    try {
      appendStepSummary(env.GITHUB_STEP_SUMMARY, scan.result);
    } catch (err) {
      console.error(`ArchGuard: unable to write the job summary: ${(err as Error).message}`);
      return 2;
    }
  }

  return scan.exitCode;
}
