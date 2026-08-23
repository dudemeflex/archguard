import type { ArchguardConfig } from '../config/schema';
import type { ArchitectureGraph } from '../interfaces';
import type { DependencyGraph, LayerDependency } from '../types';
import { evaluateLayerDependency } from '../rules/architecturePolicy';

export function collectLayerDependencies(
  graph: DependencyGraph,
  architecture: ArchitectureGraph,
  config: ArchguardConfig
): LayerDependency[] {
  const dependencies = new Map<string, LayerDependency>();

  for (const edges of Object.values(graph)) {
    for (const edge of edges) {
      for (const from of architecture.fileToLayers(edge.source)) {
        for (const to of architecture.fileToLayers(edge.target)) {
          const key = JSON.stringify([from, to]);
          const existing = dependencies.get(key);
          if (existing) {
            existing.count++;
          } else {
            dependencies.set(key, {
              from,
              to,
              count: 1,
              allowed: evaluateLayerDependency(config, from, to).allowed
            });
          }
        }
      }
    }
  }

  return Array.from(dependencies.values());
}
