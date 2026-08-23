import type { ArchitectureImpact } from '../types';

export function emptyArchitectureImpact(): ArchitectureImpact {
  return {
    layersTouched: [],
    crossLayerDependencies: [],
    unmappedChangedFiles: [],
    overlappingChangedFiles: []
  };
}
