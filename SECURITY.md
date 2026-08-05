# Security Policy

## Supported version

The production branch (`main`) is the supported version of MGP Intelligence. Security fixes are applied to production after validation in a preview deployment.

## Reporting a vulnerability

Do not publish security vulnerabilities in a public issue.

Report suspected vulnerabilities privately to the MGP platform administrator and include:

- affected route or component;
- reproduction steps;
- expected and observed behavior;
- impact assessment;
- screenshots or request identifiers when available;
- whether customer or personal data may have been exposed.

Never include passwords, session tokens, API keys or customer data in the report body.

## Response objectives

| Severity | Initial acknowledgement | Triage objective |
|---|---:|---:|
| Critical | 1 hour | 4 hours |
| High | 4 hours | 1 business day |
| Medium | 1 business day | 3 business days |
| Low | 3 business days | Planned backlog |

These are internal operating objectives and are not a contractual SLA unless incorporated into a signed agreement.

## Security principles

- Least privilege and explicit role checks.
- Tenant isolation enforced in PostgreSQL with Row-Level Security.
- Secrets stored outside source control and browser code.
- Authentication tokens stored in HttpOnly cookies.
- Audit evidence generated at database level for critical governance changes.
- Production changes require typecheck, build validation and preview deployment.
- No sensitive information in logs, errors, commits or support tickets.
- Dependencies are reviewed and updated continuously.

## Incident handling

1. Confirm and classify the incident.
2. Contain access or disable the affected capability.
3. Preserve logs and audit evidence.
4. Identify affected organizations and data.
5. Remediate and validate the fix.
6. Communicate status at an appropriate cadence.
7. Produce a post-incident review for material events.

## Customer data deletion

Organization configuration and private customer records are deleted or exported according to the applicable contract and retention policy. Public market observations may remain in the common market-data layer because they are not customer-owned private data.
