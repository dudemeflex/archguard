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

export interface ArchitectureImpact {
  layersTouched: string[];
  crossLayerDependencies: Array<{
    sourceLayer: string;
    targetLayer: string;
    source: string;
    target: string;
  }>;
  unmappedChangedFiles: string[];
  overlappingChangedFiles: Array<{
    file: string;
    layers: string[];
  }>;
}

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
  impact?: ArchitectureImpact;
  stats?: {
    changedFiles?: number;
    filesAnalyzed?: number;
    edgesAnalyzed?: number;
  };
  summary?: {
    errors?: number;
    warnings?: number;
    info?: number;
    baselineSuppressed?: number;
  };
}

export interface FindingSummary {
  errors: number;
  warnings: number;
  info: number;
  baselineSuppressed: number;
}

export interface LayerDependency {
  from: string;
  to: string;
  count: number;
  allowed: boolean;
}

export interface AuditResult {
  revision: string;
  dependencyGraph: DependencyGraph;
  findings: Finding[];
  impact: ArchitectureImpact;
  layerDependencies: LayerDependency[];
  stats: {
    filesAudited: number;
    edgesAnalyzed: number;
    layersUsed: number;
  };
  summary: FindingSummary;
}
