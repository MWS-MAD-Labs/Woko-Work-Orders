# Blind Hunter Review Request

Invoke the `bmad-review-adversarial-general` skill on the complete feature diff since baseline commit `9d501a962847a246af65c8b58d2c90ad5363f6da`.

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

Use `git diff 9d501a962847a246af65c8b58d2c90ad5363f6da` plus the untracked file contents. Assess security, authorization, correctness, data integrity, UX regressions, and spec compliance. Return concrete findings with path and line references only; do not modify files.
