import type { ArchguardConfig } from '../config/schema';
import type { ArchitectureGraph } from '../interfaces';
import { compileRepositoryGlob, normalizeRepositoryPath } from './globs';

interface CompiledLayer {
  name: string;
  matchers: Array<ReturnType<typeof compileRepositoryGlob>>;
}

export class ArchitectureGraphImpl implements ArchitectureGraph {
  private readonly layers: CompiledLayer[];

  constructor(config: Pick<ArchguardConfig, 'layers'>) {
    this.layers = config.layers.map(layer => ({
      name: layer.name,
      matchers: layer.matches.map(compileRepositoryGlob)
    }));
  }

  fileToLayers(filePath: string): string[] {
    const normalizedPath = normalizeRepositoryPath(filePath);
    return this.layers
      .filter(layer => layer.matchers.some(matches => matches(normalizedPath)))
      .map(layer => layer.name);
  }

  getLayers(): string[] {
    return this.layers.map(layer => layer.name);
  }
}
