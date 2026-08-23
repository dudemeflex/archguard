import type { RenderableArchitectureGraph } from '../../graph/types';

export function renderJsonGraph(graph: RenderableArchitectureGraph): string {
  return JSON.stringify(graph, null, 2);
}
