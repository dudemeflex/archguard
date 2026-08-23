import type { Reporter } from '../interfaces';
import type { ScanResult } from '../types';
import { formatAnnotation } from '../github/workflowCommands';

export function renderGithub(result: ScanResult): string[] {
  const findings = result.findings || [];
  const summary = result.summary ?? { errors: 0, warnings: 0, info: 0 };
  const lines = findings.map(formatAnnotation);

  if (findings.length === 0) {
    lines.push('ArchGuard: no architecture violations found.');
  } else {
    lines.push(
      `ArchGuard: ${findings.length} architecture violation(s) found `
      + `(${summary.errors ?? 0} error(s), ${summary.warnings ?? 0} warning(s), `
      + `${summary.info ?? 0} notice(s)).`
    );
  }

  return lines;
}

export class GithubReporter implements Reporter {
  async report(result: ScanResult): Promise<void> {
    for (const line of renderGithub(result)) console.log(line);
  }
}
