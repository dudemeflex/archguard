import type { Finding } from '../finding';
import type { ArchitectureImpact } from '../types';

export interface CoveragePolicy {
  requireMappedChangedFiles: boolean;
  forbidOverlappingLayers: boolean;
}

export class CoverageRuleEvaluator {
  evaluate(impact: ArchitectureImpact, policy: CoveragePolicy): Finding[] {
    const findings: Finding[] = [];

    if (policy.requireMappedChangedFiles) {
      for (const file of impact.unmappedChangedFiles) {
        findings.push({
          ruleId: 'architecture/unmapped-file',
          severity: 'error',
          title: 'Unmapped changed source file',
          message: 'Changed source file is not covered by any architecture layer.',
          file,
          evidence: `unmapped changed source file: ${file}`,
          suggestion: 'Add the file to an architecture layer or disable strict mapped-file coverage.'
        });
      }
    }

    if (policy.forbidOverlappingLayers) {
      for (const overlap of impact.overlappingChangedFiles) {
        findings.push({
          ruleId: 'architecture/overlapping-layers',
          severity: 'error',
          title: 'Overlapping architecture layers',
          message: `File "${overlap.file}" matches multiple architecture layers: ${overlap.layers.join(', ')}.`,
          file: overlap.file,
          evidence: `matching layers: ${overlap.layers.join(', ')}`,
          suggestion: 'Make layer match patterns exclusive or disable strict overlap coverage.'
        });
      }
    }

    return findings;
  }
}
