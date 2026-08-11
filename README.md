# commit-discipline-mcp

`commit-discipline-mcp` helps coding agents and developers turn a task into 2-4 ordered, test-gated Git commits. It exposes the same workflow as an MCP stdio server and as a command-line tool on Windows, macOS, and Linux.

## Requirements

- Node.js 18 or newer
- Git available on `PATH`
- A Git repository with a clean worktree when a plan is created

The package makes no runtime network calls, does not include telemetry, and never runs `git push` or history-rewriting commands.

## Install and initialize

Run directly with npm:

```sh
npx -y commit-discipline-mcp init --client all --yes
```

`init` creates project-scoped MCP configuration and a `commit-discipline` skill for Codex, Claude Code, and Cursor. Use `--dry-run` to preview, repeat `--client` to select clients, and use `--force` only to replace an existing conflicting entry. Existing configuration files are merged and backed up before updates.

Generated project paths are:

- Codex: `.codex/config.toml` and `.codex/skills/commit-discipline/SKILL.md`
- Claude Code: `.mcp.json` and `.claude/skills/commit-discipline/SKILL.md`
- Cursor: `.cursor/mcp.json` and `.cursor/skills/commit-discipline/SKILL.md`

Automatic client detection uses Node's OS-native home-directory resolution and project-local indicators. Passing `--client` explicitly is deterministic and recommended for scripted setup.

On Windows, generated stdio entries use `cmd.exe` to launch the npm shim. On macOS and Linux they invoke `npx` directly.

## Workflow

Create a JSON file containing 2-4 ordered stages:

```json
[
  {
    "id": "core",
    "title": "Build the core",
    "description": "Implement the service layer",
    "files": ["src/core.ts"]
  },
  {
    "id": "tests",
    "title": "Add coverage",
    "description": "Cover the service behavior",
    "files": ["tests/core.test.ts"]
  }
]
```

Then use the CLI:

```sh
commit-discipline plan-task --description "Build the feature" --stages-file stages.json
commit-discipline task-status
commit-discipline commit-stage core --message "feat: add core service"
commit-discipline commit-stage tests --message "test: cover core service"
commit-discipline finish-task
```

Use `--file` to commit a subset of the active stage's declared files, `--max-files` or `--max-lines` for one-off limits, `--json` for machine-readable output, and `--dry-run` to inspect a stage without running tests or changing Git/state.

When launched with no arguments, the binary starts the MCP stdio server and exposes:

- `plan_task`
- `commit_stage`
- `task_status`
- `finish_task`

## Configuration

Optional `commit-discipline.config.json`:

```json
{
  "schemaVersion": 1,
  "enforcement": "warn",
  "maxFiles": 15,
  "maxLines": 400,
  "testTimeoutMs": 900000,
  "planVisibility": "local",
  "testCommand": {
    "command": "npm",
    "args": ["test"]
  }
}
```

Defaults warn when a stage exceeds 15 files or 400 added/deleted lines. Set `enforcement` to `strict` to block instead. Failed tests always block.

Without explicit `testCommand`, the tool detects one JavaScript, Python, Go, Rust, or Make test ecosystem. If multiple ecosystems are present, configure the intended command explicitly. Missing `make` is treated as unavailable rather than as an error.

On Windows, `make test` detection requires `make` on `PATH`. Install it with `choco install make`, use another Windows package manager, or run the repository through WSL. Native npm, pnpm, Yarn, Python, Go, and Cargo commands do not require Make.

## Safety model

- Plans can only start from a clean worktree.
- Stage files are exact repo-relative paths; absolute paths and traversal are rejected.
- Only the next pending stage can be committed.
- Changes or staged files outside the active stage block the operation.
- Tests run before staging; scope and limits are checked again afterward.
- Manual commits that move `HEAD` outside the plan are detected.
- Local plan state is stored in `.commit-discipline/plan.json` and ignored by default.
- Dry runs do not execute tests, stage files, create commits, or update plan state.

## Development

```sh
npm ci
npm run verify
npm run smoke:package
npm run benchmark:git
```

The release gate runs type checking, 46+ unit/integration tests, a complete packed-package CLI/MCP lifecycle, native-shell `npx` checks, and Node 18/20/22 jobs on `windows-latest`, `ubuntu-latest`, and `macos-latest`.

`benchmark:git` measures `commit_stage` overhead after subtracting the test command's own runtime, discards one warm-up sample, and reports the median of five repositories against the PRD's 300ms target. The report is intentionally visible rather than hidden behind a platform-dependent assertion: Git process startup varies substantially by OS, antivirus, filesystem, and CI host.

After an npm release, the manually dispatched Registry smoke workflow verifies the exact registry command `npx -y commit-discipline-mcp@<version> --help` through PowerShell, cmd.exe, Bash, and Zsh.

## License

MIT
