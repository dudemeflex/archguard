import type { ArchitecturePolicyGraph } from '../../graph/types';

export function renderJsonGraph(graph: ArchitecturePolicyGraph): string {
  return JSON.stringify(graph, null, 2);
}
