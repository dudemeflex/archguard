/**
 * Interfaces for future components. These are *specs only* (no implementations here).
 */

import { DependencyGraph, ScanResult } from '../types';

export interface GitAdapter {
  // Return list of changed files in the working tree/commit range
  listChangedFiles(): Promise<string[]>;
  // Get file contents at a given revision (or working tree)
  getFileContents(filePath: string, rev?: string): Promise<string>;
}

export interface DependencyAnalyzer {
  // Build a dependency graph represented as a mapping from file to dependency edges
  analyze(files: string[]): Promise<DependencyGraph>;
}

export interface ArchitectureGraph {
  fileToLayers(filePath: string): string[];
  getLayers(): string[];
}

// RuleEvaluator evaluates rules against a dependency graph and returns a ScanResult
export interface RuleEvaluator {
  evaluate(graph: DependencyGraph, cfg: unknown): Promise<ScanResult>;
}

// Single reporter interface used by the system
export interface Reporter {
  report(result: ScanResult): Promise<void>;
}
