import type { Reporter } from '../interfaces';
import type { ScanResult } from '../types';
import { formatAnnotation } from '../github/workflowCommands';
import { activeFindings } from '../findings/summary';

export function renderGithub(result: ScanResult): string[] {
  const allFindings = result.findings || [];
  const findings = activeFindings(allFindings);
  const baselineSuppressed = allFindings.length - findings.length;
  const summary = result.summary ?? { errors: 0, warnings: 0, info: 0 };
  const lines = findings.map(formatAnnotation);

  if (findings.length === 0) {
    lines.push(baselineSuppressed > 0
      ? `ArchGuard: no new architecture violations found (${baselineSuppressed} baseline violation(s) suppressed).`
      : 'ArchGuard: no architecture violations found.');
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
