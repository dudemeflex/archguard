import type { Reporter } from '../interfaces';
import type { ScanResult } from '../types';
import { emptyArchitectureImpact } from '../impact/empty';
import { summarizeFindings } from '../findings/summary';

export function renderJson(result: ScanResult): string {
  const findings = result.findings || [];
  const computed = summarizeFindings(findings);
  const summary = {
    errors: computed.errors,
    warnings: computed.warnings,
    info: computed.info,
    ...(computed.baselineSuppressed > 0
      ? { baselineSuppressed: computed.baselineSuppressed }
      : {})
  };

  const output = {
    comparison: result.comparison ?? { base: 'unknown', head: 'HEAD' },
    changes: result.changes || [],
    dependencyGraph: result.dependencyGraph || {},
    impact: result.impact || emptyArchitectureImpact(),
    findings,
    stats: result.stats || {},
    summary
  } as const;

  return JSON.stringify(output, null, 2);
}

export class JsonReporter implements Reporter {
  async report(result: ScanResult): Promise<void> {
    console.log(renderJson(result));
  }
}
