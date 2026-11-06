# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately, never in a public issue, pull request, or discussion:

- **Email:** contact@factlot.com, with "SECURITY" at the start of the subject line.
- **GitHub:** private vulnerability reporting on this repository ("Security" tab, "Report a
  vulnerability").

Include the affected package and version (or commit), the steps or input that reproduce the
problem, and what you expected instead. We aim to acknowledge a report within three business days,
keep you informed while we fix it, and credit you in the release notes unless you ask us not to.
Please give us a reasonable time to release a fix before you disclose the issue publicly.

## Supported versions

FactLot has not had a numbered release yet. Until 1.0, security fixes go into the latest release
and the `main` branch only; earlier `0.x` releases are not patched. Every package in this
repository (`@factlot/*` on npm and `factlot` on PyPI) shares one version number.

| Version               | Supported |
| --------------------- | --------- |
| `main` / latest `0.x` | Yes       |
| Older `0.x` releases  | No        |

## Scope

FactLot's local packages make no network calls and store no data. The hosted connector
(`@factlot/server`), the MCP server (`@factlot/mcp`), the Python SDK (`factlot`, including the
registry collector and ingest), the Docker image, and the GitHub workflows are all in scope.
Please report especially:

- ways to make a calculator return a wrong result without a warning
- ID collisions or normalization bugs that would make two different real-world things share an ID
- tool input that makes the server or an SDK spend unbounded CPU or memory, crash, or answer with
  internal detail (paths, stack traces, another tenant's data)
- ways around bearer-key authentication, the per-key or per-IP limits, or the `/v1/usage` admin key
- ways to make the collector fetch a non-public address, write outside its output directory, or
  publish something that is not the publisher's file
- issues in the MCP server's input handling

A self-hosted public deployment must handle TLS termination, an edge firewall or rate limit,
and log retention itself.

## Customer documents

Leases and other documents given to FactLot Ingest are handled under the
[customer documents policy](docs/customer-documents.md): self-hosted ingest sends page text to the
model provider and nothing anywhere else; a hosted version will store documents encrypted, per
customer, for a stated retention period, and never train on them or log them. Please also report:

- any way document text could reach a log, an error report, or another customer's account
- any field in an ingest report that carries page text beyond the quotes that are evidence
