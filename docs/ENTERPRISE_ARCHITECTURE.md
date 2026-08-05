# MGP Intelligence — Enterprise Architecture

## Purpose

MGP Intelligence is a multi-tenant SaaS for retailer and brand intelligence. Public market observations are shared as a common data layer, while every customer's configuration, users, reports, alerts, review decisions and audit evidence are isolated by organization.

## Trust boundaries

1. **Browser** — receives only data authorized for the signed-in user.
2. **Next.js application** — validates the Supabase session and calls authenticated RPCs.
3. **Supabase Auth** — establishes the user identity.
4. **PostgreSQL / Row-Level Security** — enforces tenant isolation independently of the UI.
5. **Supabase Vault / private schema** — stores provider secrets such as the administrator-managed AI key.
6. **Public market-data layer** — catalog, prices, promotions and availability collected from monitored retailers.

Tenant isolation is never based only on hiding menu items. PostgreSQL policies use `auth.uid()` and active organization membership for every enterprise table.

## Organization model

```text
Organization
├── Members and roles
├── Invitations
├── Operational settings
├── Retailer / brand / category scope
├── Enabled modules and plan limits
├── Alert rules
├── Match reviews
├── Report jobs
├── Data-quality snapshots
└── Audit events
```

Organization types:

- `platform`: MGP administration.
- `retailer`: retailer-oriented workspace.
- `brand`: brand-oriented workspace.

Lifecycle states: `trial`, `active`, `suspended`, `archived`.

## Roles

| Role | Purpose | Main permissions |
|---|---|---|
| Owner | Accountable customer administrator | Full organization governance; at least one active owner must remain |
| Admin | Operational administrator | Users, scopes, settings and alerts |
| Analyst | Power user | Analysis, alerts, match review and reports |
| Executive | Decision maker | Read access and executive reports |
| Viewer | Restricted consumer | Read-only access |

MGP SaaS administrators are registered separately in the private `saas_admins` table and can govern all tenants.

## Enterprise database objects

- `organizations`
- `user_profiles`
- `organization_members`
- `organization_invitations`
- `organization_settings`
- `organization_scopes`
- `alert_rules`
- `match_reviews`
- `report_jobs`
- `data_quality_snapshots`
- `audit_logs`

All tables have Row-Level Security enabled. Anonymous access is revoked.

## Auditing

Database triggers record inserts, updates and deletes for:

- organizations;
- memberships;
- invitations;
- settings and scopes;
- alert rules;
- match reviews;
- report requests.

The audit record includes the organization, actor, action, entity, previous values, current values, metadata and timestamp. Because auditing occurs in PostgreSQL, a client cannot bypass it by calling a different application endpoint.

## Data-quality framework

The Data Quality Center records immutable time-stamped snapshots with:

- crawl completion;
- valid-price coverage;
- known-stock coverage;
- image coverage;
- matching coverage;
- failed tasks;
- stale products;
- total measured products.

Initial operating targets:

| Indicator | Target |
|---|---:|
| Crawl completion | 98% |
| Valid prices | 97% |
| Known stock | 98% |
| Image coverage | 90% |
| Matching coverage | 90% |
| Maximum stale age | 24 hours |

Targets are operating objectives, not contractual SLA commitments until performance has been measured over an agreed period.

## Application interfaces

### Customer and administrator context

- `GET /api/enterprise/context`
- `GET /api/enterprise/organization?organizationId=...`

### SaaS administration

- `GET /api/enterprise/admin`
- `POST /api/enterprise/admin`

### Tenant governance

- `POST /api/enterprise/organization`
- `GET|POST|DELETE /api/enterprise/alerts`
- `GET /api/enterprise/audit`
- `GET|POST /api/enterprise/data-quality`
- `GET|POST /api/enterprise/match-reviews`
- `GET|POST /api/enterprise/reports`

All endpoints require a valid HttpOnly session cookie. Permission checks are repeated in PostgreSQL RPCs.

## Security controls implemented

- Tenant isolation with PostgreSQL RLS.
- Granular roles.
- HttpOnly, Secure production cookies.
- Secrets outside the browser and repository.
- Security-definer RPCs with explicit authorization checks.
- Anonymous grants revoked from enterprise objects.
- Automatic audit trails.
- Defensive response headers: frame denial, MIME sniffing prevention, restricted browser permissions and strict referrer handling.
- CI typecheck and production build validation.
- Dependency update automation through Dependabot.

## Remaining enterprise roadmap

These controls require external configuration or operating history and are deliberately not represented as completed:

- SAML/OIDC SSO and SCIM provisioning;
- mandatory MFA policy by organization;
- external penetration test;
- SOC 2 or ISO 27001 audit;
- contractual SLA based on measured availability;
- outbound alert provider and customer email-domain setup;
- automated PDF/XLSX/PPTX report workers;
- customer ERP, PIM, inventory, margin and sales integrations;
- tested disaster-recovery runbook and status page.

## Release discipline

Enterprise changes must pass:

1. TypeScript validation.
2. Next.js production build.
3. Database migration review.
4. RLS isolation test for a user without membership.
5. SaaS administrator access test.
6. Vercel preview deployment.
7. Production deployment verification.
