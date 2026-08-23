export const sampleConfig = `# ArchGuard config (schema version 1)
# Cross-layer dependencies must be listed in mayDependOn.
version: 1
layers:
  - name: infrastructure
    matches:
      - "src/infrastructure/**"
    mayDependOn:
      - domain
  - name: domain
    matches:
      - "src/domain/**"
    mayDependOn: []
  - name: application
    matches:
      - "src/application/**"
    mayDependOn:
      - domain
`;
