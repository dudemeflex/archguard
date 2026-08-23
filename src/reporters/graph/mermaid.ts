import type { RenderableArchitectureGraph } from '../../graph/types';

function escapeMermaidLabel(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#13;')
    .replace(/\n/g, '&#10;');
}

export function renderMermaidGraph(graph: RenderableArchitectureGraph): string {
  const nodeIds = new Map(graph.layers.map((layer, index) => [layer.name, `layer_${index}`]));
  const lines = ['flowchart LR'];
  for (const layer of graph.layers) {
    lines.push(`  ${nodeIds.get(layer.name)}["${escapeMermaidLabel(layer.name)}"]`);
  }
  if (graph.edges.length > 0) lines.push('');
  for (const edge of graph.edges) {
    if ('count' in edge) {
      const label = `${edge.count}${edge.allowed ? '' : ' forbidden'}`;
      lines.push(`  ${nodeIds.get(edge.from)} -->|${label}| ${nodeIds.get(edge.to)}`);
    } else {
      lines.push(`  ${nodeIds.get(edge.from)} --> ${nodeIds.get(edge.to)}`);
    }
  }
  return lines.join('\n');
}
