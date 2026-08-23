export interface ArchitectureGraphLayer {
    name: string;
    matches: string[];
    mayDependOn: string[];
}

export interface ArchitecturePolicyGraph {
  layers: ArchitectureGraphLayer[];
  edges: Array<{
    from: string;
    to: string;
    allowed: true;
  }>;
}

export interface ActualArchitectureGraph {
  revision: string;
  layers: ArchitectureGraphLayer[];
  edges: Array<{
    from: string;
    to: string;
    count: number;
    allowed: boolean;
  }>;
}

export type RenderableArchitectureGraph = ArchitecturePolicyGraph | ActualArchitectureGraph;
