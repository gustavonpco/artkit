# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately through GitHub's "Report a vulnerability" (Security Advisories) on this repository.

Include the affected package and version, a description of the impact and, if possible, a minimal reproduction.

## Response targets

| Step                            | Target             |
| ------------------------------- | ------------------ |
| Acknowledge the report          | 3 business days    |
| Initial assessment and severity | 7 business days    |
| Fix for critical/high severity  | 30 days            |
| Fix for medium/low severity     | next minor release |

We credit reporters in the release notes unless they prefer to stay anonymous.

## Scope

In scope: every `@artkit-ai/*` package, including validation of model input, sanitization (links, SVG, CSV formula injection), store scope isolation, the HTTP routes in `@artkit-ai/node`, headless rendering isolation and, from phase 2, the `app` sandbox.

The security model is described in [docs/spec.md §16](docs/spec.md).
