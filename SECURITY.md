# Security Policy

## Supported versions

The newest published version receives security fixes while the package is
below `1.0`. Older versions, including legacy alpha releases, are unsupported
after a fixed version is available.

## Reporting

Report suspected vulnerabilities through GitHub private vulnerability
reporting:

https://github.com/global-torque/sdk/security/advisories/new

Do not open a public issue or include API keys, OTPs, private keys, seed
phrases, customer data, private URLs, or unpublished vulnerability details in
public artifacts. A maintainer should acknowledge a complete report within
five business days and provide a triage decision or request more information
within ten business days.

## Scope

Reports about exact-origin credential isolation, untrusted response-body isolation,
EIP-7702 delegate validation, pending-call resumption, Turnkey authentication,
or incorrect success gating are in scope. Provider availability and defects in
an application's injected backend callbacks should be reported to their
respective owners.
