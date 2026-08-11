# Release success metrics

The package does not collect telemetry. Measure the PRD's outcomes manually and publish only aggregate, non-identifying results.

## v0.1.0 baseline

Record these values on the release date:

- npm version and release timestamp
- Git commit containing the release
- Windows, macOS, and Linux registry-smoke result URLs
- test count, dependency-audit result, and median Git-overhead result per OS

## 30-day review

On day 30, review:

1. OS-specific defects: count confirmed Windows, macOS, and Linux compatibility reports separately.
2. Commit granularity: collect voluntary before/after commits-per-task reports without repository names or source contents.
3. Failing-suite safety: search issues for any confirmed commit created after a failing detected test command. The release target is zero.
4. Skill reliability: count reports where Codex, Claude Code, or Cursor required explicit skill invocation instead of automatic selection.
5. Remediation: link every confirmed defect to a test and released fix; do not close a report based only on documentation.

## Reporting template

```text
Review period:
Package versions:
OS-specific defects (Windows/macOS/Linux):
Voluntary commits-per-task observations:
Commits created over failing tests:
Explicit skill-invocation reports:
Follow-up actions and links:
```
