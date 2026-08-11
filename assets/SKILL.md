---
name: commit-discipline
description: Plan implementation work into small test-gated Git commits and record each stage through commit-discipline-mcp.
---

# Commit Discipline

Use this skill for implementation work that should be split into reviewable commits.

1. Before editing, call `plan_task` with 2-4 ordered stages and exact repository-relative files.
2. Work only on the current stage's declared files.
3. Call `commit_stage` for the current stage instead of running `git commit` directly.
4. Check `task_status` before moving to the next stage.
5. Call `finish_task` only after every stage is committed and the worktree is clean.

Never use this tool to push, rewrite history, or bypass failing tests.
