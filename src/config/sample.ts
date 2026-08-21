export const sampleConfig = `# Archguard config (schema version 1)
# Define layers and rules for allowed dependencies between layers.
version: 1
layers:
  - name: infrastructure
    matches:
      - "src/infrastructure/**"
  - name: domain
    matches:
      - "src/domain/**"
  - name: application
    matches:
      - "src/application/**"

rules:
  - name: no-infra-deps-on-app
    description: "Infrastructure must not depend on application layer"
    from: infrastructure
    to: application
    allow: false
`;
