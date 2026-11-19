# Progress — facilities booking improvements

Plan: `2026-11-19-facilities-improvements.md`.

- User opted to proceed with manager-defined categories and Jakarta time.
- Used a fresh clone of staging in the approved temporary workspace; no pre-existing local work was changed. No extra worktree was created.
- Baseline: 122 tests pass with `NODE_OPTIONS=--no-experimental-webstorage`. Without the flag, this machine's Node webstorage behavior causes three pre-existing EnvironmentBanner test failures.
- Notification email tests were observed failing for missing facilities actions before implementation.
- Disposable PostgreSQL integration tests were observed failing for missing notifications and category persistence before implementation. PostgreSQL installed only in external temporary test tooling, not added as a project dependency.
- Inventory/search/time UI tests were observed failing before implementation. Notification action test was observed failing before implementation.
- Task 1 implemented: transactional manager/requester notifications and existing email queue, booking-specific localized email/action and push target.
- Task 2 implemented: migration 0031, backward-compatible category API, category suggestions, quick search/category filtering, preserved selections, refreshed inventory drafts.
- Task 3 implemented: explicit WIB input guidance and timezone-stable displays, same-day coverage, updated product documentation.
- Verification: 132 unit/UI/domain tests passed, 29 facilities integration tests passed, 13 SSO integration tests passed. Typecheck, build, git diff --check passed.
- Live mailbox delivery not verified; no live emails sent, no deployment, no push, no production database changes.
- Independent review completed. Two important inventory issues were reproduced with failing tests, fixed, and verified: filtered rows stay visible during editing, and saving a row preserves other unsaved drafts. The final suite passes 134 unit/UI/domain tests. Build, typecheck and diff checks pass after fixes.
- Review hardening deferred: the existing delivery worker does not suppress already-queued notifications if a recipient is subsequently disabled. Active-manager filtering at notification creation is enforced; delivery-time suppression is outside this change's scope.
- Integration remains verified at 29 facilities and 13 SSO tests; final review fixes only changed web inventory state and its tests.
