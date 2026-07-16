# Security Policy

## Supported version

Security fixes are applied to the current `main` branch. The npm packages are not considered supported releases until their first registry publication.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability or include real credentials or personal data in a report.

Use GitHub's [private vulnerability reporting](https://github.com/kumagaizo/latentmachine/security/advisories/new). Include:

- the affected surface and version or commit;
- a minimal reproduction using synthetic data;
- the likely impact;
- any mitigation you have already tested.

You should receive an acknowledgment within seven days. After triage, the maintainer will share the expected fix and disclosure timeline through the private advisory.

## Scope

Reports about data parsing, rule execution, denial of service, MCP request handling, generated code, dependency provenance, or accidental data disclosure are in scope. The browser tools are designed to process core workflow data locally; any behavior that unexpectedly transmits that data is high priority.
