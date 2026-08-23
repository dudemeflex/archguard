import picomatch from 'picomatch';
import type { ArchguardConfig } from '../config/schema';
import type { ArchitectureGraph } from '../interfaces';

interface CompiledLayer {
  name: string;
  matchers: Array<ReturnType<typeof picomatch>>;
}

function normalizeRepositoryPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

export class ArchitectureGraphImpl implements ArchitectureGraph {
  private readonly layers: CompiledLayer[];

  constructor(config: Pick<ArchguardConfig, 'layers'>) {
    this.layers = config.layers.map(layer => ({
      name: layer.name,
      matchers: layer.matches.map(pattern => picomatch(normalizeRepositoryPath(pattern), {
        dot: true,
        nonegate: true,
        posixSlashes: true,
        strictBrackets: true
      }))
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
