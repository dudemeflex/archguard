import type { ArchguardConfig } from '../config/schema';
import type { ArchitecturePolicyGraph } from './types';

function pairKey(from: string, to: string): string {
  return JSON.stringify([from, to]);
}

export function createArchitecturePolicyGraph(config: ArchguardConfig): ArchitecturePolicyGraph {
  const explicitRules = new Map(
    config.rules.map(rule => [pairKey(rule.from, rule.to), rule.allow])
  );
  const edges: ArchitecturePolicyGraph['edges'] = [];
  const seen = new Set<string>();

  const addAllowedEdge = (from: string, to: string) => {
    if (from === to) return;
    const key = pairKey(from, to);
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, allowed: true });
  };

  for (const layer of config.layers) {
    for (const target of layer.mayDependOn || []) {
      if (explicitRules.get(pairKey(layer.name, target)) === false) continue;
      addAllowedEdge(layer.name, target);
    }
  }
  for (const rule of config.rules) {
    if (rule.allow && explicitRules.get(pairKey(rule.from, rule.to)) === true) {
      addAllowedEdge(rule.from, rule.to);
    }
  }

  return {
    layers: config.layers.map(layer => ({
      name: layer.name,
      matches: [...layer.matches],
      mayDependOn: [...(layer.mayDependOn || [])]
    })),
    edges
  };
}
