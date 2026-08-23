import type { ArchitecturePolicyGraph } from '../../graph/types';

function escapeDotString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

export function renderDotGraph(graph: ArchitecturePolicyGraph): string {
  const lines = ['digraph ArchGuard {'];
  for (const layer of graph.layers) lines.push(`  "${escapeDotString(layer.name)}";`);
  if (graph.edges.length > 0) lines.push('');
  for (const edge of graph.edges) {
    lines.push(`  "${escapeDotString(edge.from)}" -> "${escapeDotString(edge.to)}";`);
  }
  lines.push('}');
  return lines.join('\n');
}
