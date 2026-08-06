---
title: 'Recurring location work lists'
type: 'feature'
created: '2026-08-06'
status: 'in-review'
baseline_commit: '9d501a962847a246af65c8b58d2c90ad5363f6da'
review_loop_iteration: 0
context:
  - 'Woko/docs/architecture.md'
  - 'Woko/docs/product/PRD.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Facilities workers currently submit a broad Google Form that does not distinguish routine frequency, location, individual contribution, evidence, or missed work. Managers cannot quickly verify which assigned areas were completed, late, or had problems.

**Approach:** Add a standalone, mobile-first Work Lists capability for location-based recurring checklists. Administrators and Facilities Managers define reusable templates and assign worker teams; workers collaboratively complete due location occurrences with item-level attribution, a short update, and photo evidence; managers monitor activity and receive a weekly digest.

## Boundaries & Constraints

**Always:** Keep Work Lists separate from work-order workflow, reports, and work-order numbering. Reuse the configured campus/building/location hierarchy, `APP_TIME_ZONE`, authenticated roles, 15 MiB evidence validation/image processing, Google Drive storage, PostgreSQL auditability, durable notifications, and idempotent background jobs. Only Administrators and Facilities Managers may create, edit, activate, deactivate, or change template assignments; assigned Workers may view and update only their own current/historical occurrences; Facilities Managers and Administrators may view every occurrence. A template contains ordered checklist items, each with a required/optional flag, instructions, and one recurrence (`DAILY`, `WEEKLY`, or `MONTHLY`). Generate each occurrence independently by assigned leaf location and recurrence: daily ends at 17:00 local time; weekly ends Saturday 17:00; monthly ends on the last Saturday of the month at 17:00. Editing a template must not alter already-created occurrence/item snapshots. A shared occurrence is complete only after every required item is resolved, an overall description is supplied, and at least one photo has uploaded successfully.

**Ask First:** Do not introduce a new external storage provider, new user roles, offline mutation/sync, worker-specific duplicate occurrences, or unrelated reporting/dashboard changes without approval.

**Never:** Do not convert recurring work lists into work orders, require every assigned worker to duplicate a completion, require a photo for every item, let PICs manage templates, silently mark incomplete items complete, or delete historical templates, submissions, photos, or audit records.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|----------------|---------------------------|----------------|
| Collaborative completion | Two assigned workers open the same due location occurrence | Each can save item status; each resolution records their identity/time; required items completed or explicitly resolved, one photo, and overall note permit submission | Use occurrence versioning/transactions; return a conflict response and refresh state if a stale final submit would overwrite newer data |
| Exception item | Worker selects `NOT_APPLICABLE` or `ISSUE_FOUND` | Require an item explanation; issue remains conspicuous to managers; resolved items count toward occurrence completion | Reject blank explanation; preserve issue data and audit event |
| Missed period | Required work remains incomplete after its local 17:00 cutoff | Mark occurrence overdue; send each affected assigned worker one summarized due/overdue notification per local day until completion | Idempotency keys prevent duplicate notifications across scheduler runs/replicas |
| Evidence failure | Worker submits without a photo or photo upload fails validation/storage | Do not submit occurrence; retain saved item progress and explain what must be fixed | Enforce existing MIME/size checks and surface upload/API error |
| Template change | Manager edits items, locations, or worker team after occurrences exist | Future generated occurrences use the new version; historical/current snapshots retain original task, location, and assignments | Deactivate rather than delete a template with history |

</frozen-after-approval>

## Code Map

- `apps/api/migrations/` -- ordered PostgreSQL schema migrations for operational records, notifications, jobs, and Drive metadata.
- `apps/api/src/app.ts` -- mounts authenticated API route modules under `/api/v1`.
- `apps/api/src/auth.ts` -- session authentication and Administrator/Facilities Manager authorization helpers.
- `apps/api/src/work-orders.ts` -- reference-location query and established multipart evidence, transaction, optimistic-version, audit, and Drive-upload patterns to adapt without coupling the domains.
- `apps/api/src/evidence.ts` / `apps/api/src/drive.ts` -- validated image preparation and Drive upload primitives.
- `apps/api/src/background.ts` -- local-time scheduler, persistent queue worker, idempotent notifications, retries, and stale lock recovery.
- `apps/api/src/notifications.ts` / `apps/api/src/notification-localization.ts` / `apps/api/src/notification-email.ts` -- in-app notification listing, bilingual copy, and optional Gmail delivery.
- `apps/web/src/App.tsx` -- authenticated shell, primary/mobile navigation, initial data loading, and modal view wiring.
- `apps/web/src/WorkOrderForms.tsx` -- established mobile form, people-picker, nested location-picker, and evidence-upload interaction patterns.
- `apps/web/src/types.ts` / `apps/web/src/api.ts` / `apps/web/src/styles.css` -- shared client contracts, API client/upload progress, and responsive styling.

## Tasks & Acceptance

**Execution:**
- [ ] `apps/api/migrations/0019_recurring_work_lists.sql` -- create template, versioned item/location/worker assignment, immutable occurrence/item snapshot, item resolution, occurrence evidence, and audit tables; add indexes/constraints for recurrence, status, unique period-location generation, and query scope.
- [ ] `apps/api/src/work-lists.ts` -- add authenticated, Zod-validated API routes: manager template CRUD/activation; worker/manager scoped occurrence lists and details; collaborative item resolution; mandatory overall note/photo submission; manager activity detail. Enforce authorization, use transactions and optimistic occurrence versions, snapshot template data, and emit auditable actions.
- [ ] `apps/api/src/app.ts` -- mount the Work Lists route module at `/api/v1`.
- [ ] `apps/api/src/drive.ts` and `apps/api/src/evidence.ts` -- add a dedicated recurring-work evidence folder/helper while preserving existing safe upload processing and metadata rules; store evidence against the occurrence rather than a work order.
- [ ] `apps/api/src/background.ts` -- generate due occurrences from active templates in `APP_TIME_ZONE`; determine daily/Saturday/last-Saturday deadlines at 17:00; generate idempotent daily worker overdue summaries; queue Monday 08:00 local weekly Facilities Manager all-activity digests; make completion-late/overdue state deterministic and testable.
- [ ] `apps/api/src/notification-localization.ts`, `apps/api/src/notification-email.ts`, and `apps/api/src/notifications.ts` -- support localized Work List reminder/digest copy and links/data that do not assume a work-order ID; retain current email retry and in-app read/acknowledge behavior.
- [ ] `apps/api/src/work-lists.test.ts` and `apps/api/src/background.test.ts` -- cover permission boundaries, recurrence/date calculations, snapshot immutability, shared-worker attribution, required evidence/note, exceptions, stale writes, daily notification idempotency, and Monday digest content.
- [ ] `apps/web/src/types.ts` and `apps/web/src/api.ts` -- define typed Work List template, occurrence, item, evidence, summary, and upload requests/responses.
- [ ] `apps/web/src/WorkListsView.tsx` -- build responsive worker and manager views: assigned due/overdue lists grouped by location; fast item status updates with `COMPLETED`, `NOT_APPLICABLE`, `ISSUE_FOUND`; completion attribution/timestamps; issue emphasis; camera/file photo upload; overall note/submission; manager all-activity detail and historical filters.
- [ ] `apps/web/src/WorkListTemplateForm.tsx` -- provide Administrator/Facilities Manager template management with existing nested location picker and worker picker, ordered item instructions/requiredness/frequency, active status, and clear schedule text; no PIC management controls.
- [ ] `apps/web/src/App.tsx`, `apps/web/src/i18n.ts`, and `apps/web/src/styles.css` -- add bilingual, responsive Work Lists navigation/modal state and reusable mobile-first layout/styles without regressing work-order navigation, notifications, or bottom navigation.
- [ ] `apps/web/src/work-lists.test.tsx` (or focused pure UI helpers) -- test role-gated navigation, completion/submission requirements, exception-note behavior, and manager versus worker data presentation.
- [ ] `docs/product/PRD.md` and `README.md` -- document Work Lists as a distinct recurring operations capability, manager/template permissions, schedules, evidence rule, and notification/digest behavior.

**Acceptance Criteria:**
- Given an Administrator or Facilities Manager, when they create an active template for selected existing locations and Workers, then each future location-period occurrence contains the configured ordered item snapshots and shared assigned worker team.
- Given a PIC or Worker without management role, when they attempt template management, then the UI does not expose controls and the API rejects the request.
- Given a worker assigned to a due occurrence, when they resolve items with valid statuses, provide required exception notes, an overall description, and at least one valid photo, then the occurrence is submitted with per-item worker/timestamp attribution and viewable evidence.
- Given several assigned workers, when they update the same occurrence, then their changes contribute to one shared record and no worker must submit a duplicate checklist.
- Given a daily, weekly, or monthly occurrence, when local time crosses its 17:00 deadline, then it becomes overdue unless submitted; Saturday and last-Saturday rules apply respectively for weekly and monthly work.
- Given overdue Work List occurrences, when the background scheduler runs on a local day, then each affected worker receives no more than one idempotent in-app/email reminder summarizing their outstanding occurrences; reminders stop once all relevant occurrences are completed.
- Given Monday 08:00 in `APP_TIME_ZONE`, when the scheduler runs, then every active Facilities Manager receives an idempotent weekly all-activity digest for the prior Monday–Sunday period, including on-time/late/overdue activity, issues, worker/location totals, and links to occurrence evidence.
- Given a manager edits or deactivates a template, when historical/current occurrences are opened, then their original snapshots and audit/evidence history remain unchanged while future generation follows the active current template.

## Design Notes

Use one occurrence per **template × applicable leaf location × recurrence period**, shared by the assigned team. Item resolution is additive and attributable rather than a yes/no form response. The initial template library should separate the existing form’s activities into daily routine cleaning, Saturday deep cleaning, and last-Saturday monthly inspection/deep work; “other activities” is an optional free-text addition, not a required checklist item.

Persist a materialized occurrence state (`OPEN`, `SUBMITTED`, `OVERDUE`, `SUBMITTED_LATE`) for fast worker/manager queries, but calculate/create periods idempotently from schedule rules. Use a neutral recurring-work association for notifications and email deep links rather than falsely attaching these records to `work_orders`.

## Verification

**Commands:**
- `npm run typecheck` -- expected: all workspaces type-check.
- `npm test` -- expected: new recurrence, authorization, collaboration, evidence, reminder, and digest tests pass with existing suites.
- `npm run build` -- expected: domain, API, and PWA production builds succeed.
- `npm run db:migrate` -- expected: migration applies cleanly to a representative PostgreSQL database.

**Manual checks:**
- On a phone-sized viewport, submit a daily location checklist as one assigned Worker and complete remaining items as another; verify clear attribution and one shared result.
- Check Indonesian and English Work Lists labels/notifications, an overdue daily list after 17:00, Saturday/last-Saturday generation, Drive photo links, and Monday manager digest delivery when Gmail is configured.
