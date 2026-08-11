# Security policy

## Supported versions

Security fixes are provided for the latest published minor release.

| Version | Supported |
| --- | --- |
| `0.1.x` | Yes |
| Older versions | No |

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability.

Use GitHub's private vulnerability reporting flow:

1. Open the repository's **Security** tab.
2. Select **Advisories**.
3. Select **Report a vulnerability**.
4. Include affected versions, reproduction steps, impact, and any suggested mitigation.

You can start at [the private advisory form](https://github.com/ayush-singh-0601/commit-discipline-mcp/security/advisories/new).

Please avoid including secrets or private repository contents. A minimal throwaway repository is preferred for reproductions.

## Response targets

- Initial acknowledgement: within 3 business days.
- Triage and severity assessment: within 7 business days.
- Status updates: at least every 7 business days while a confirmed issue is being fixed.

Timelines may vary with severity and complexity. Confirmed issues will be coordinated privately until a fix or mitigation is available.

## Security model

The package:

- Runs locally and contains no telemetry.
- Makes no runtime network calls.
- Rejects absolute and repository-traversing stage paths.
- Runs only Git and the selected project test command.
- Never pushes, resets, rebases, or rewrites Git history.

For more detail, see [docs/architecture.md](./docs/architecture.md#trust-boundaries).
