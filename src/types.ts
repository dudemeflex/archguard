export type ChangeType = 'added' | 'modified' | 'deleted' | 'renamed';

export interface RepositoryChange {
  type: ChangeType;
  path: string;
  oldPath?: string;
}

export interface DependencyEdge {
  source: string;
  target: string;
  specifier?: string;
  line?: number;
}

export type DependencyGraph = Record<string, DependencyEdge[]>;

export interface ArchitectureLayer {
  name: string;
  matches: string[];
  mayDependOn?: string[];
  companionChange?: string[];
}

export interface ArchitectureGraphView {
  fileToLayers(filePath: string): string[];
  getLayers(): string[];
}

import type { Finding } from './finding';

export interface ScanResult {
  comparison?: {
    base: string;
    head: string;
  };
  findings: Finding[];
  changes?: RepositoryChange[];
  dependencyGraph?: DependencyGraph;
  stats?: {
    changedFiles?: number;
    filesAnalyzed?: number;
    edgesAnalyzed?: number;
  };
  summary?: {
    errors?: number;
    warnings?: number;
    info?: number;
  };
}
