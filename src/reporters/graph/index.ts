import type { RenderableArchitectureGraph } from '../../graph/types';
import { renderDotGraph } from './dot';
import { renderJsonGraph } from './json';
import { renderMermaidGraph } from './mermaid';
import { renderPrettyGraph } from './pretty';

export type GraphFormat = 'pretty' | 'json' | 'mermaid' | 'dot';

export function renderArchitectureGraph(
  graph: RenderableArchitectureGraph,
  format: GraphFormat
): string {
  if (format === 'json') return renderJsonGraph(graph);
  if (format === 'mermaid') return renderMermaidGraph(graph);
  if (format === 'dot') return renderDotGraph(graph);
  return renderPrettyGraph(graph);
}
