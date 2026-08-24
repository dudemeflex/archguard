# Contributing to ArchGuard

Thank you for helping improve ArchGuard. Contributions should keep the tool deterministic, repository-local, and straightforward to run in continuous integration.

## Development setup

You need Node.js 20 or newer and Git.

```bash
git clone https://github.com/dudemeflex/archguard.git
cd archguard
npm ci
```

Run the complete validation suite before opening a pull request:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run build:action
npm pack --dry-run
```

The test command builds both the CLI and GitHub Action bundle before running Vitest. The separate build commands above make each release artifact explicit.

## Making changes

- Keep pull requests focused on one coherent problem.
- Add or update tests for behavior changes and regressions.
- Preserve deterministic output and avoid network-dependent analysis.
- Update the README and command help when user-facing behavior changes.
- Do not commit `dist/`, dependency directories, logs, environment files, or temporary test repositories.

`action-dist/index.js` is intentionally committed because GitHub Actions runs it directly. If Action source or bundled dependencies change, run `npm run build:action` and include the resulting bundle update.

## Pull requests

Describe the problem, the chosen approach, and how you verified the result. Mention compatibility or output-format changes explicitly because CLI, JSON, SARIF, and Action consumers may depend on them.

Maintainers may ask for a smaller change or additional tests when that makes a review safer and easier to reproduce.

## Security reports

Do not open a public issue for a suspected vulnerability. Follow [SECURITY.md](SECURITY.md) instead.
