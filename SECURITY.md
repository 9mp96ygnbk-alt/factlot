# Security policy

Please report vulnerabilities privately, not in public issues. Use GitHub's private
vulnerability reporting on this repository ("Security" tab, "Report a vulnerability").

FactLot's local packages make no network calls and store no data. Please report especially:

- ways to make a calculator return a wrong result without a warning
- ID collisions or normalization bugs that would make two different real-world things share an ID
- issues in the MCP server's input handling

## Customer documents

Leases and other documents given to FactLot Ingest are handled under the
[customer documents policy](docs/customer-documents.md): self-hosted ingest sends page text to the
model provider and nothing anywhere else; a hosted version will store documents encrypted, per
customer, for a stated retention period, and never train on them or log them. Please also report:

- any way document text could reach a log, an error report, or another customer's account
- any field in an ingest report that carries page text beyond the quotes that are evidence
