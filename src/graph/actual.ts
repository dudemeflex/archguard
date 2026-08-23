import type { ArchguardConfig } from '../config/schema';
import type { AuditResult } from '../types';
import type { ActualArchitectureGraph } from './types';

export function createActualArchitectureGraph(
  config: ArchguardConfig,
  audit: AuditResult
): ActualArchitectureGraph {
  return {
    revision: audit.revision,
    layers: config.layers.map(layer => ({
      name: layer.name,
      matches: [...layer.matches],
      mayDependOn: [...(layer.mayDependOn || [])]
    })),
    edges: audit.layerDependencies.map(dependency => ({ ...dependency }))
  };
}
