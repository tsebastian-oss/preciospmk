# MGP Intelligence — Enterprise Architecture

## Purpose

MGP Intelligence is a multi-tenant SaaS for retailer and brand intelligence. Public market observations are shared as a common data layer, while every customer's configuration, users, reports, alerts, review decisions and audit evidence are isolated by organization.

## Trust boundaries

1. **Browser** — receives only data authorized for the signed-in user.
2. **Next.js application** — validates the Supabase session and calls authenticated RPCs.
3. **Supabase Auth** — establishes the user identity and delivers user invitations.
4. **PostgreSQL / Row-Level Security** — enforces tenant isolation independently of the UI.
5. **Supabase Vault / private schema** — stores AI, email-provider and internal dispatch secrets.
6. **Private Storage** — stores generated enterprise reports and exposes temporary signed URLs.
7. **Public market-data layer** — catalog, prices, promotions and availability collected from monitored retailers.

Tenant isolation is never based only on hiding menu items. PostgreSQL policies use `auth.uid()` and active organization membership for every enterprise table. Market-data APIs additionally resolve the active organization, validate the contracted module and apply retailer, brand and category scopes.

## Organization model

```text
Organization
├── Members and roles
├── Invitations
├── Operational settings
├── Retailer / brand / category scope
├── Enabled modules and plan limits
├── Alert rules and events
├── Notification deliveries
├── Match reviews
├── Report jobs and private files
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
| Executive | Decision maker | Read access, alert acknowledgement and executive reports |
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
- `alert_events`
- `notification_deliveries`
- `match_reviews`
- `report_jobs`
- `data_quality_snapshots`
- `audit_logs`

All enterprise tables have Row-Level Security enabled. Anonymous access is revoked.

## Tenant-scoped application access

Every private analytical API resolves the active organization from an HttpOnly cookie or the user's saved organization. PostgreSQL then verifies:

1. active membership or SaaS-administrator status;
2. organization lifecycle status;
3. whether the requested module is enabled;
4. retailer, brand and category scope.

The dashboard, product explorer, promotions, price matching, competitive AI, brand intelligence and price movements all apply these controls server-side. Hiding a menu item is therefore a convenience, not a security boundary.

## User provisioning

Administrators invite users from Enterprise Control. The invitation service:

- checks the caller's organization role;
- records the invitation and its expiry;
- grants access immediately when the user already exists;
- otherwise sends a Supabase Auth invitation;
- provisions the user profile and organization membership when the invitation is accepted;
- records the changes in the audit trail.

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

The Data Quality Center records hourly, immutable snapshots with:

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

## Alerting and notifications

The alert evaluator runs every 15 minutes and supports:

- price changes;
- promotions;
- stock-outs;
- assortment changes;
- new products;
- data-quality thresholds;
- pending match reviews.

Events are deduplicated by rule and cooldown window. Every event is visible in the in-app notification center and creates governed delivery records. Email delivery supports Resend or Brevo and runs every five minutes with retry backoff. The provider API key is stored in Supabase Vault and email delivery remains disabled until the SaaS administrator configures a verified sender.

## Enterprise reports

Enterprise Control can generate:

- executive reports;
- brand and retailer scorecards;
- pricing, promotion, availability and assortment reports;
- data-quality reports;
- audit exports.

Validated formats:

- PDF;
- Excel (`.xlsx`);
- CSV.

Files are generated by an authenticated Supabase Edge Function, stored in the private `enterprise-reports` bucket and exposed through temporary signed download URLs. Report requests, processing state, failures and completion are recorded in `report_jobs` and audited.

## Application interfaces

### Customer and administrator context

- `GET|POST /api/enterprise/context`
- `GET|POST /api/enterprise/organization`

### SaaS administration

- `GET|POST /api/enterprise/admin`
- `GET|POST /api/admin/ai`
- `GET|POST /api/admin/notifications`

### Tenant governance

- `GET|POST|DELETE /api/enterprise/alerts`
- `GET|POST /api/enterprise/alert-events`
- `GET /api/enterprise/audit`
- `GET|POST /api/enterprise/data-quality`
- `GET|POST /api/enterprise/match-reviews`
- `GET|POST /api/enterprise/reports`

All endpoints require a valid HttpOnly session cookie. Permission checks are repeated in PostgreSQL RPCs.

## Security controls implemented

- Tenant isolation with PostgreSQL RLS.
- Active-tenant and module authorization on analytical APIs.
- Granular roles.
- HttpOnly, Secure production cookies.
- Secrets outside the browser and repository.
- Security-definer RPCs with explicit authorization checks.
- Anonymous grants revoked from enterprise objects.
- Automatic audit trails.
- Private storage and expiring report URLs.
- Defensive response headers: frame denial, MIME sniffing prevention, restricted browser permissions and strict referrer handling.
- CI typecheck, critical dependency audit and production build validation.
- Dependency update automation through Dependabot.
- Scheduled quality snapshots, alert evaluation and notification dispatch.

## Remaining enterprise roadmap

These controls require external configuration, independent verification or customer integrations and are deliberately not represented as completed:

- SAML/OIDC SSO and SCIM provisioning;
- mandatory MFA policy by organization;
- external penetration test;
- SOC 2 or ISO 27001 audit;
- contractual SLA based on measured availability;
- verified sender domain and Resend/Brevo API configuration;
- PowerPoint report generation;
- customer ERP, PIM, inventory, margin and sales integrations;
- tested disaster-recovery runbook and public status page.

## Release discipline

Enterprise changes must pass:

1. TypeScript validation.
2. Critical dependency audit.
3. Next.js production build.
4. Database migration review.
5. RLS isolation test for a user without membership.
6. SaaS-administrator access test.
7. Alert evaluator and notification-delivery test.
8. Vercel preview deployment.
9. Production deployment verification.
