/**
 * Interfaces for future components. These are *specs only* (no implementations here).
 */

import type { DependencyGraph, ScanResult, RepositoryChange } from '../types';
import type { ArchguardConfig } from '../config/schema';

export interface GitAdapter {
  getChanges(base: string, head: string): Promise<RepositoryChange[]>;
  getFileContents(filePath: string, rev?: string): Promise<string>;
}

export interface DependencyAnalyzer {
  analyze(files: string[]): Promise<DependencyGraph>;
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
