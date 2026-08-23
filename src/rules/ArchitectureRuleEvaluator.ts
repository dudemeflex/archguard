import type { ArchguardConfig } from '../config/schema';
import type { ArchitectureGraph, RuleEvaluator } from '../interfaces';
import type { Finding } from '../finding';
import type { DependencyEdge, DependencyGraph } from '../types';
import { ArchitectureGraphImpl } from '../architecture/ArchitectureGraph';

const ARCHITECTURE_DEPENDENCY_RULE_ID = 'architecture/dependency';

function pairKey(sourceLayer: string, targetLayer: string): string {
  return JSON.stringify([sourceLayer, targetLayer]);
}

function evidenceKey(
  edge: DependencyEdge,
  sourceLayer: string,
  targetLayer: string
): string {
  return JSON.stringify([
    edge.source,
    edge.target,
    sourceLayer,
    targetLayer,
    edge.specifier ?? null,
    edge.line ?? null
  ]);
}

function formatEvidence(edge: DependencyEdge): string {
  const via = edge.specifier ? ` via "${edge.specifier}"` : '';
  return `${edge.source} -> ${edge.target}${via}`;
}

export class ArchitectureRuleEvaluator implements RuleEvaluator {
  constructor(private readonly architecture?: ArchitectureGraph) {}

  async evaluate(graph: DependencyGraph, config: ArchguardConfig): Promise<Finding[]> {
    const architecture = this.architecture ?? new ArchitectureGraphImpl(config);
    const allowedDependencies = new Map(
      config.layers.map(layer => [layer.name, new Set(layer.mayDependOn ?? [])])
    );
    const explicitRules = new Map<string, boolean>();
    for (const rule of config.rules) {
      explicitRules.set(pairKey(rule.from, rule.to), rule.allow);
    }

    const findings: Finding[] = [];
    const seen = new Set<string>();

    for (const sourcePath of Object.keys(graph)) {
      for (const edge of graph[sourcePath]) {
        const sourceLayers = architecture.fileToLayers(edge.source);
        const targetLayers = architecture.fileToLayers(edge.target);
        if (sourceLayers.length === 0 || targetLayers.length === 0) continue;

        for (const sourceLayer of sourceLayers) {
          for (const targetLayer of targetLayers) {
            if (this.isAllowed(sourceLayer, targetLayer, allowedDependencies, explicitRules)) continue;

            const key = evidenceKey(edge, sourceLayer, targetLayer);
            if (seen.has(key)) continue;
            seen.add(key);

            findings.push({
              ruleId: ARCHITECTURE_DEPENDENCY_RULE_ID,
              severity: 'error',
              title: 'Forbidden architecture dependency',
              message: `Layer "${sourceLayer}" may not depend on layer "${targetLayer}".`,
              file: edge.source,
              ...(edge.line === undefined ? {} : { line: edge.line }),
              sourceLayer,
              targetLayer,
              evidence: formatEvidence(edge),
              suggestion: 'Depend on an allowed layer or update .archguard.yml.'
            });
          }
        }
      }
    }

    return findings;
  }

  private isAllowed(
    sourceLayer: string,
    targetLayer: string,
    allowedDependencies: Map<string, Set<string>>,
    explicitRules: Map<string, boolean>
  ): boolean {
    const explicitRule = pairKey(sourceLayer, targetLayer);
    if (explicitRules.has(explicitRule)) {
      return explicitRules.get(explicitRule) === true;
    }
    if (sourceLayer === targetLayer) return true;
    return allowedDependencies.get(sourceLayer)?.has(targetLayer) === true;
  }
}
