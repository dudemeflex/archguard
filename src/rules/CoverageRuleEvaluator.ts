import type { Finding } from '../finding';
import type { ArchitectureImpact } from '../types';
import {
  overlapFindingFingerprint,
  unmappedFindingFingerprint
} from '../findings/fingerprint';

export interface CoveragePolicy {
  requireMappedChangedFiles: boolean;
  forbidOverlappingLayers: boolean;
  scope?: 'changed' | 'audited';
}

export class CoverageRuleEvaluator {
  evaluate(impact: ArchitectureImpact, policy: CoveragePolicy): Finding[] {
    const findings: Finding[] = [];

    if (policy.requireMappedChangedFiles) {
      for (const file of impact.unmappedChangedFiles) {
        const audited = policy.scope === 'audited';
        findings.push({
          ruleId: 'architecture/unmapped-file',
          severity: 'error',
          title: audited ? 'Unmapped audited source file' : 'Unmapped changed source file',
          message: audited
            ? 'Audited source file is not covered by any architecture layer.'
            : 'Changed source file is not covered by any architecture layer.',
          file,
          fingerprint: unmappedFindingFingerprint('architecture/unmapped-file', file),
          evidence: `unmapped ${audited ? 'audited' : 'changed'} source file: ${file}`,
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
          fingerprint: overlapFindingFingerprint(
            'architecture/overlapping-layers',
            overlap.file,
            overlap.layers
          ),
          evidence: `matching layers: ${overlap.layers.join(', ')}`,
          suggestion: 'Make layer match patterns exclusive or disable strict overlap coverage.'
        });
      }
    }

    return findings;
  }
}
