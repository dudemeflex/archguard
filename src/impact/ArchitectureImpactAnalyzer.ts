import type { ArchitectureGraph } from '../interfaces';
import type {
  ArchitectureImpact,
  DependencyGraph,
  RepositoryChange
} from '../types';
import { isSupportedSourcePath } from '../sourceFiles';

export class ArchitectureImpactAnalyzer {
  constructor(private readonly architecture: ArchitectureGraph) {}

  analyze(changes: RepositoryChange[], dependencyGraph: DependencyGraph): ArchitectureImpact {
    const touched = new Set<string>();
    const unmappedChangedFiles: string[] = [];
    const overlappingChangedFiles: ArchitectureImpact['overlappingChangedFiles'] = [];
    const seenChangedFiles = new Set<string>();

    for (const change of changes) {
      if (seenChangedFiles.has(change.path)) continue;
      seenChangedFiles.add(change.path);
      const layers = this.architecture.fileToLayers(change.path);
      for (const layer of layers) touched.add(layer);
      if (change.type === 'renamed' && change.oldPath) {
        for (const layer of this.architecture.fileToLayers(change.oldPath)) touched.add(layer);
      }

      if (!isSupportedSourcePath(change.path)) continue;
      if (layers.length === 0) unmappedChangedFiles.push(change.path);
      if (layers.length > 1) overlappingChangedFiles.push({ file: change.path, layers });
    }

    const crossLayerDependencies: ArchitectureImpact['crossLayerDependencies'] = [];
    const seenDependencies = new Set<string>();
    for (const edges of Object.values(dependencyGraph)) {
      for (const edge of edges) {
        const sourceLayers = this.architecture.fileToLayers(edge.source);
        const targetLayers = this.architecture.fileToLayers(edge.target);
        for (const sourceLayer of sourceLayers) {
          for (const targetLayer of targetLayers) {
            if (sourceLayer === targetLayer) continue;
            const key = JSON.stringify([sourceLayer, targetLayer, edge.source, edge.target]);
            if (seenDependencies.has(key)) continue;
            seenDependencies.add(key);
            crossLayerDependencies.push({
              sourceLayer,
              targetLayer,
              source: edge.source,
              target: edge.target
            });
          }
        }
      }
    }

    return {
      layersTouched: this.architecture.getLayers().filter(layer => touched.has(layer)),
      crossLayerDependencies,
      unmappedChangedFiles,
      overlappingChangedFiles
    };
  }
}
