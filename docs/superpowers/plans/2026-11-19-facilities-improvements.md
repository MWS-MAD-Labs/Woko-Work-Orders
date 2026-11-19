# Facilities booking improvements Implementation Plan

**Goal:** Notify facilities managers of requests and requesters of approvals, make inventory searchable by category, and make same-day time bookings clear.

**Architecture:** Extend the existing Fastify/PostgreSQL facilities routes and React view. Insert notifications within booking transactions and reuse the notification-triggered email/push jobs. Store a manager-defined category string on assets, reusing existing category names through suggestions rather than building a separate taxonomy administration screen.

**Tech Stack:** TypeScript, React, Fastify, PostgreSQL, Vitest.

**Scope/defaults:** User authorized proceeding with manager-defined categories and Asia/Jakarta time. Work in the fresh staging checkout; leave main unchanged. Do not send live email or deploy merely to verify code. Existing assets become Uncategorized. Blank category inputs normalize to Uncategorized. Search is case-insensitive across item name, code and category, with an additional category filter in inventory, the asset summary, and booking selection. Preserve selected booking items when filters change.

## Review focus
- Failed or repeated decisions must not emit approval notifications; insert in the same transaction as the state change.
- Inactive managers receive no notifications; deduplicate recipients by selecting users with facilities.manage permission.
- Existing API clients omitting category continue to work; edits omitting category must retain the category.
- Filtering must not silently replace already selected booking items, and new inventory items must appear after reload.
- Same-day positive intervals work, equal/reversed intervals fail, and all booking displays use Jakarta time regardless of browser timezone.

## Tasks

### 1. Transactional booking notifications
- [ ] Add integration assertions for manager recipients, inactive exclusions, approval recipient, exactly-once behavior, and notification-email jobs.
- [ ] Add failing email/localization tests for booking types and facilities links.
- [ ] Insert FACILITIES_BOOKING_REQUESTED and FACILITIES_BOOKING_APPROVED notifications with stable idempotency keys inside their owning transactions; approval includes purpose, location, Jakarta time range and decision note.
- [ ] Extend localized email templates and in-app navigation for facilities notifications without work-order fields.
- [ ] Run API unit tests and dedicated disposable-database integration suite.

### 2. Categories and quick search
- [ ] Add failing integration tests for category create/update/default/preservation; add failing UI tests for search/filter/selection and refreshed inventory.
- [ ] Add migration 0030 (or next available sequence) for facilities_assets.category, default Uncategorized and bounded nonblank input.
- [ ] Extend asset API reads/writes/audits, retaining prior category when an older update omits it.
- [ ] Add category field with reusable suggestions and shared search/filter controls to inventory, summary and booking selection; keep all selected options available.
- [ ] Run focused API and web tests.

### 3. Booking times and final verification
- [ ] Add failing timezone-display tests and same-day/equal/reversed-interval coverage.
- [ ] Explicitly label Jakarta/WIB time, keep date-and-time controls, and render all times in Asia/Jakarta.
- [ ] Update facilities product documentation with notifications, categories and verification limitations.
- [ ] Run full tests with NODE_OPTIONS=--no-experimental-webstorage, typecheck, build, integration tests when local PostgreSQL is available, and git diff --check.
- [ ] Review changes for authorization, migration compatibility, notification links and transaction boundaries; report code verification separately from live email delivery.
