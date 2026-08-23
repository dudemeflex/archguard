import type { RenderableArchitectureGraph } from '../../graph/types';

export function renderPrettyGraph(graph: RenderableArchitectureGraph): string {
  if ('revision' in graph) {
    const lines = ['Actual architecture', '', `Revision: ${graph.revision}`, '', 'Observed dependencies:'];
    if (graph.edges.length === 0) lines.push('  (none)');
    for (const edge of graph.edges) {
      lines.push(
        `  ${edge.from} -> ${edge.to}: ${edge.count}${edge.allowed ? '' : ' forbidden'}`
      );
    }
    return lines.join('\n');
  }
  const lines = ['Architecture'];
  for (const layer of graph.layers) {
    const dependencies = graph.edges
      .filter(edge => edge.from === layer.name)
      .map(edge => edge.to);
    lines.push('', layer.name, '  matches:');
    for (const pattern of layer.matches) lines.push(`    ${pattern}`);
    lines.push('  may depend on:');
    if (dependencies.length === 0) lines.push('    (none)');
    else for (const dependency of dependencies) lines.push(`    ${dependency}`);
  }
  return lines.join('\n');
}
