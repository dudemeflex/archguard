export const sampleConfig = `# ArchGuard config (schema version 1)
version: 1

coverage:
  requireMappedChangedFiles: false
  forbidOverlappingLayers: false

audit:
  exclude:
    - "generated/**"

layers:
  - name: ui
    matches:
      - "src/ui/**"
    mayDependOn:
      - application
      - shared

  - name: application
    matches:
      - "src/application/**"
    mayDependOn:
      - domain
      - shared
    companionChange:
      - "test/application/**"

  - name: domain
    matches:
      - "src/domain/**"
    mayDependOn:
      - shared
    companionChange:
      - "test/domain/**"

  - name: shared
    matches:
      - "src/shared/**"
    mayDependOn: []
`;
