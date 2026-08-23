import type { ArchguardConfig } from '../config/schema';
import type { ArchitectureGraph, RuleEvaluator } from '../interfaces';
import type { Finding } from '../finding';
import type { DependencyEdge, DependencyGraph } from '../types';
import { ArchitectureGraphImpl } from '../architecture/ArchitectureGraph';
import { dependencyFindingFingerprint } from '../findings/fingerprint';
import { evaluateLayerDependency } from './architecturePolicy';

const ARCHITECTURE_DEPENDENCY_RULE_ID = 'architecture/dependency';

function formatEvidence(edge: DependencyEdge): string {
  const via = edge.specifier ? ` via "${edge.specifier}"` : '';
  return `${edge.source} -> ${edge.target}${via}`;
}

export class ArchitectureRuleEvaluator implements RuleEvaluator {
  constructor(private readonly architecture?: ArchitectureGraph) {}

  async evaluate(graph: DependencyGraph, config: ArchguardConfig): Promise<Finding[]> {
    const architecture = this.architecture ?? new ArchitectureGraphImpl(config);
    const findings: Finding[] = [];
    const seen = new Set<string>();

    for (const sourcePath of Object.keys(graph)) {
      for (const edge of graph[sourcePath]) {
        const sourceLayers = architecture.fileToLayers(edge.source);
        const targetLayers = architecture.fileToLayers(edge.target);
        if (sourceLayers.length === 0 || targetLayers.length === 0) continue;

        for (const sourceLayer of sourceLayers) {
          for (const targetLayer of targetLayers) {
            if (evaluateLayerDependency(config, sourceLayer, targetLayer).allowed) continue;

            const fingerprint = dependencyFindingFingerprint({
              ruleId: ARCHITECTURE_DEPENDENCY_RULE_ID,
              source: edge.source,
              target: edge.target,
              sourceLayer,
              targetLayer,
              specifier: edge.specifier
            });
            if (seen.has(fingerprint)) continue;
            seen.add(fingerprint);

            findings.push({
              ruleId: ARCHITECTURE_DEPENDENCY_RULE_ID,
              severity: 'error',
              title: 'Forbidden architecture dependency',
              message: `Layer "${sourceLayer}" may not depend on layer "${targetLayer}".`,
              file: edge.source,
              ...(edge.line === undefined ? {} : { line: edge.line }),
              sourceLayer,
              targetLayer,
              fingerprint,
              evidence: formatEvidence(edge),
              suggestion: 'Depend on an allowed layer or update .archguard.yml.'
            });
          }
        }
      }
    }

    return findings;
  }
}
