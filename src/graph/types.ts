export interface ArchitecturePolicyGraph {
  layers: Array<{
    name: string;
    matches: string[];
    mayDependOn: string[];
  }>;
  edges: Array<{
    from: string;
    to: string;
    allowed: true;
  }>;
}
