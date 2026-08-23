import type { Finding } from '../finding';
import type { FindingSummary } from '../types';

export function isBaselineSuppressed(finding: Finding): boolean {
  return finding.baseline?.suppressed === true;
}

export function activeFindings(findings: Finding[]): Finding[] {
  return findings.filter(finding => !isBaselineSuppressed(finding));
}

export function summarizeFindings(findings: Finding[]): FindingSummary {
  const summary: FindingSummary = {
    errors: 0,
    warnings: 0,
    info: 0,
    baselineSuppressed: 0
  };
  for (const finding of findings) {
    if (isBaselineSuppressed(finding)) {
      summary.baselineSuppressed++;
      continue;
    }
    if (finding.severity === 'error') summary.errors++;
    else if (finding.severity === 'warning') summary.warnings++;
    else summary.info++;
  }
  return summary;
}
