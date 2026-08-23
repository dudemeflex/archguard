import type { ArchitecturePolicyGraph } from '../../graph/types';

export function renderPrettyGraph(graph: ArchitecturePolicyGraph): string {
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
