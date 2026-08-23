/**
 * Interfaces for future components. These are *specs only* (no implementations here).
 */

import type { DependencyGraph, ScanResult, RepositoryChange } from '../types';
import type { ArchguardConfig } from '../config/schema';

export interface GitAdapter {
  getChanges(base: string, head: string): Promise<RepositoryChange[]>;
  getFileContents(filePath: string, rev?: string): Promise<string>;
  fileExistsAtRevision(filePath: string, rev: string): Promise<boolean>;
  getFileSizeAtRevision(filePath: string, rev: string): Promise<number | null>;
  isSymlinkAtRevision(filePath: string, rev: string): Promise<boolean>;
  getRepositoryRoot(): Promise<string>;
}

export interface DependencyAnalyzer {
  analyze(files: string[], revision?: string): Promise<DependencyGraph>;
}

export interface ArchitectureGraph {
  fileToLayers(filePath: string): string[];
  getLayers(): string[];
}

export interface RuleEvaluator {
  evaluate(graph: DependencyGraph, cfg: ArchguardConfig): Promise<ScanResult>;
}

export interface Reporter {
  report(result: ScanResult): Promise<void>;
}
