# Contributing

Thanks for helping make `commit-discipline-mcp` safer and more useful. Small, focused contributions are especially welcome—the repository follows the same commit discipline it promotes.

## Before opening an issue

- Search existing issues and discussions for the same problem.
- Use the latest published version or the current `main` branch.
- Include the operating system, Node.js version, Git version, client, and a minimal reproduction.
- Do not include access tokens, private repository contents, or sensitive command output.

Security vulnerabilities should follow [SECURITY.md](./SECURITY.md), not a public issue.

## Development setup

Requirements:

- Node.js 18 or newer
- Git
- npm

```sh
git clone https://github.com/ayush-singh-0601/commit-discipline-mcp.git
cd commit-discipline-mcp
npm ci
npm run verify
```

Useful checks:

```sh
npm run verify
npm run smoke:package
npm run benchmark:git
npm audit
```

`npm run verify` is the minimum pull-request gate. Run the packed-package smoke test when changing CLI, MCP, initialization, packaging, or platform behavior.

## Change guidelines

1. Keep each pull request focused on one problem.
2. Add or update tests for behavior changes.
3. Preserve Windows, Linux, and macOS compatibility.
4. Avoid shell-specific assumptions in shared runtime paths.
5. Update the README or docs when user-facing behavior changes.
6. Do not add telemetry or implicit network calls.

Use clear commit messages such as:

```text
feat: detect pnpm test commands
fix: preserve staged files during dry runs
docs: clarify Cursor initialization
test: cover Unicode repository paths
```

## Pull requests

A good pull request includes:

- A short explanation of the problem and why the change solves it.
- Tests that fail without the change and pass with it, when applicable.
- The exact verification commands run.
- Notes about platform-specific behavior.
- Screenshots only when documentation or visual output changes.

Maintainers may ask for a large change to be split into smaller reviewable commits.

## Design principles

Changes should preserve these invariants:

- The repository is clean when a plan begins.
- Only declared stage files are eligible for a stage commit.
- Tests complete before staging.
- Failed tests never produce a commit.
- The package never pushes or rewrites Git history.
- Local user data stays local.

See [docs/architecture.md](./docs/architecture.md) for the component boundaries and commit transaction.
