# ArchGuard

ArchGuard is a deterministic command-line tool and GitHub Action for enforcing repository-owned architecture rules. It compares Git revisions or audits a complete committed tree, maps JavaScript and TypeScript files to architectural layers, and reports policy violations before they are merged.

Use ArchGuard to:

- prevent forbidden dependencies between layers;
- require companion changes such as tests, documentation, contracts, or migrations;
- detect changed source files that are unmapped or assigned to overlapping layers;
- review architecture impact for a pull request;
- audit a full repository at an exact Git revision;
- adopt rules incrementally with a versioned baseline;
- export JSON, SARIF, Mermaid, or Graphviz DOT output;
- annotate pull requests through a self-contained Node.js 20 GitHub Action.

ArchGuard reads policy from the repository. It does not require a hosted service or execute the source code it analyzes.

## Requirements

- Node.js 20 or newer
- Git
- a JavaScript or TypeScript repository

## Quick start

Install ArchGuard as a development dependency:

```bash
npm install --save-dev archguard
```

Create and validate a starter configuration:

```bash
npx archguard init
npx archguard validate
```

Then compare the current revision with your main branch:

```bash
npx archguard scan --base main
```

Exit code `0` means the operation completed without blocking findings, `1` means policy violations were found, and `2` means configuration, Git, analysis, or runtime setup failed.

## Configuration

ArchGuard uses `.archguard.yml` by default. Configuration schema version 1 supports layers, dependency policy, companion changes, coverage controls, audit exclusions, and an optional baseline path.

```yaml
version: 1

coverage:
  requireMappedChangedFiles: true
  forbidOverlappingLayers: true

audit:
  exclude:
    - "vendor/**"
    - "**/*.generated.ts"

baseline:
  path: ".archguard-baseline.json"

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
      - "docs/domain/**"

  - name: shared
    matches:
      - "src/shared/**"
    mayDependOn: []

rules:
  - name: allow-ui-domain-types
    description: UI may depend directly on the domain layer.
    from: ui
    to: domain
    allow: true
```

Layer and audit patterns are repository-relative globs. An explicit named rule overrides `mayDependOn` for its `from` and `to` pair. Same-layer dependencies are allowed unless an explicit rule forbids them.

When a changed file belongs to a layer with `companionChange`, at least one path in the changeset must match a configured companion pattern. Added, modified, deleted, and renamed paths count; both the old and new path are considered for renames.

Coverage checks are optional in configuration. `scan --strict` enables both checks for a single invocation.

## Commands

Run `archguard --help` or `archguard <command> --help` for the complete option reference.

### Validate policy

Validate the configuration, referenced layers, glob syntax, and any configured or discovered baseline without scanning Git history:

```bash
npx archguard validate
npx archguard validate --config config/architecture.yml
```

### Scan changes

Compare two Git revisions and evaluate supported changed source files:

```bash
npx archguard scan --base main
npx archguard scan --base main --head HEAD --impact
npx archguard scan --base main --strict
npx archguard scan --base main --format json
npx archguard scan --base main --format sarif --output archguard.sarif
npx archguard scan --base main --no-baseline
```

Scan formats are `pretty`, `json`, `github`, and `sarif`. `--output` is supported for JSON and SARIF. Every scan calculates touched layers, cross-layer dependency transitions, unmapped changed files, and overlapping layer assignments; `--impact` expands those details in terminal output.

### Audit a repository

Audit all supported tracked source files in a committed Git tree:

```bash
npx archguard audit
npx archguard audit --revision main
npx archguard audit --format json
npx archguard audit --format sarif --output archguard-audit.sarif
npx archguard audit --no-baseline
```

Audits read the requested Git tree, so uncommitted files do not affect the result. The default limit is 20,000 selected source files and can be changed with `--max-files`. Common generated directories are excluded automatically; add repository-specific patterns under `audit.exclude`.

Because companion-change rules describe a changeset, full-repository audits evaluate dependency and coverage policy but not companion changes.

### Render architecture graphs

Render configured policy or aggregate dependencies observed during a full audit:

```bash
npx archguard graph
npx archguard graph --format mermaid --output architecture.mmd
npx archguard graph --format dot
npx archguard graph --actual --revision HEAD --format json
```

Graph formats are `pretty`, `json`, `mermaid`, and `dot`. Policy graphs do not scan source files. `--actual` performs a bounded audit and reports observed layer-to-layer edge counts with the applicable policy decision.

### Explain a decision

Explain how policy maps and evaluates two repository paths:

```bash
npx archguard explain src/ui/App.ts src/domain/user.ts
npx archguard explain src/ui/App.ts src/domain/user.ts --format json
```

The result identifies mapped layers and whether the decision came from a named rule, same-layer policy, or `mayDependOn`. If either path is unmapped, the relationship is reported as not evaluated.

### Manage a baseline

A baseline records existing findings so a repository can block new architecture debt without first fixing every current violation:

```bash
npx archguard audit --no-baseline
npx archguard baseline create
git add .archguard-baseline.json

npx archguard baseline status
npx archguard baseline update
```

`baseline update` removes resolved fingerprints and does not add new findings. `baseline status` exits with code `1` while new violations exist. Use `baseline create --force` only when intentionally replacing the stored baseline with all current findings.

Normal scans and audits suppress matching baseline findings from blocking output while retaining them in JSON. Use `--show-baseline` to display suppressed details or `--no-baseline` to evaluate all findings.

## GitHub Action

Add a workflow such as `.github/workflows/archguard.yml`:

```yaml
name: ArchGuard

on:
  pull_request:

permissions:
  contents: read

jobs:
  architecture:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: dudemeflex/archguard@main
```

For strict supply-chain controls, pin `uses` to a reviewed full commit SHA. When a stable release tag is available, a version tag can be used according to your repository policy.

The Action resolves pull-request base and head SHAs from the event, emits workflow annotations, and writes a compact report to `GITHUB_STEP_SUMMARY`. It needs only the checked-out repository and read access to contents.

Supported inputs:

| Input | Default | Purpose |
| --- | --- | --- |
| `base` | pull-request base SHA | Explicit Git base revision |
| `head` | pull-request head SHA or `HEAD` | Explicit Git head revision |
| `config` | `.archguard.yml` | Repository-relative configuration path |
| `baseline` | discovered/configured baseline | Baseline file path |
| `ignore-baseline` | `false` | Report all findings without baseline suppression |

## Findings and output

Stable rule identifiers include:

- `architecture/dependency`
- `architecture/companion-change`
- `architecture/unmapped-file`
- `architecture/overlapping-layers`

Findings include stable SHA-256 fingerprints for baseline and reporting workflows. Dependency fingerprints omit line numbers so unrelated line insertions do not turn stored debt into a new finding. SARIF includes ArchGuard fingerprints for compatible code-scanning systems.

## Analysis scope

ArchGuard supports `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, and `.cts`. It recognizes ES imports and exports, type-only imports and exports, literal `require()` calls, and static `import()` calls with revision-aware repository-local relative resolution.

The analyzer does not execute target code, use the network, resolve external packages or TypeScript path aliases, or follow Git symlink dependency targets. Source files larger than 5 MB are rejected before parsing.

## Development

Clone the repository and run the complete local checks with Node.js 20 or newer:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run build:action
npm pack --dry-run
```

`dist/` is local compiler output and is excluded from Git. `action-dist/index.js` is the tracked, self-contained Action runtime referenced by `action.yml`; rebuild it whenever Action source or bundled dependencies change.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution workflow and [SECURITY.md](SECURITY.md) for responsible vulnerability reporting.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
NOT RELEASED BUILDS CAN CONTAIN BUGS AND EXPLOITS, PLEASE USE THEM ON YOU OWN RISK!
