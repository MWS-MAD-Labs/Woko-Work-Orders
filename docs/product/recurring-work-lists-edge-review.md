# Edge Case Hunter Review Request

Invoke the `bmad-review-edge-case-hunter` skill on the complete feature diff since baseline commit `9d501a962847a246af65c8b58d2c90ad5363f6da`.

Repository: `Woko`

Review the tracked and untracked changes in these files:

- `apps/api/migrations/0019_recurring_work_lists.sql`
- `apps/api/src/work-lists.ts`
- `apps/api/src/background.ts`
- `apps/api/src/app.ts`
- `apps/web/src/WorkListsView.tsx`
- `apps/web/src/WorkListTemplateForm.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/types.ts`
- `apps/web/src/styles.css`
- `README.md`
- `docs/product/PRD.md`
- `docs/product/spec-recurring-work-lists.md`

Use `git diff 9d501a962847a246af65c8b58d2c90ad5363f6da` plus the untracked file contents. Focus on time zones/cutoffs, recurrence boundaries, duplicate scheduler runs, multi-worker concurrency, template edits, evidence failure, stale versions, authorization, and notification/digest delivery. Return concrete findings with path and line references only; do not modify files.
