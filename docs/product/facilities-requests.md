# Facilities requests

Facilities bookings use a local PostgreSQL asset register; no external asset service is required. Apply migration `0026_facilities_requests.sql` with the normal `npm run db:migrate` command before running this version.

## Setup and permissions

- Administrators configure the default facilities manager from **Manage inventory**; the selected user must be active and have the Facilities Manager or Administrator role. Managers and administrators can read the current assignment.
- Managers and administrators maintain asset names, unique codes, quantities and active status.
- Users submit bookings and see their own requests; managers and administrators see all requests.
- Only the assigned approver can approve/reject, inspect returns or resolve return issues. A manager role alone does not grant authority over someone else's assigned request.

## Booking and return policy

- Start must be in the future and end must follow start. Both endpoints must fall no later than the end of the date two calendar months ahead in Asia/Jakarta, clamped at month end.
- Booking form datetime inputs represent Jakarta school time.
- Pending and approved reservations hold inventory for their booking intervals. Concurrent requests serialize on asset rows to prevent overbooking.
- Approved overdue equipment remains unavailable until inspected. Unresolved damaged/missing returns conservatively hold the full borrowed quantity for the affected asset line until a manager resolves it; per-unit mixed-condition returns are not supported.
- Requesters may cancel pending bookings. The assigned approver must provide a decision note, and cannot approve a booking that has already started.
- Return inspection is available only after the borrowing period ends. Every asset line must be inspected. A GOOD return requires the full borrowed quantity; damaged or missing lines require issue notes.
- Issue-bearing returns appear as RETURNED_WITH_ISSUES. Resolving issues requires a note and releases their inventory hold; the manager must confirm the equipment is fit to re-enter inventory before resolving.
- Asset reductions/deactivation cannot invalidate existing commitments or unresolved returns. Changes and lifecycle actions generate audit events.

## Verification

```sh
npm test
npm run typecheck
npm run build
# Use a dedicated disposable PostgreSQL database, never the production database:
DATABASE_URL=postgres://hermes@127.0.0.1:55439/woko_facilities_test AUTH_MODE=test npm run db:migrate
DATABASE_URL=postgres://hermes@127.0.0.1:55439/woko_facilities_test AUTH_MODE=test npm run test:integration -w @woko/api
```

Integration tests reset facilities tables and work-order settings in the test database. They are excluded from the default unit-test command and require an explicit integration command. Test identities via `x-test-user-id` are for AUTH_MODE=test only.

Facilities bookings are separate from repair work orders. This feature does not automatically import assets, deliver notification emails or mark overdue bookings returned. Physical return verification remains the assigned manager's responsibility.
