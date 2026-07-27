import { describe, expect, it } from 'vitest';
import { getProjectProgress } from './work-order-progress';

const base = { work_type: 'INTERNAL' as const, status: 'ACTIVE' as const, procurement: { status: 'NOT_REQUIRED' as const } };

describe('project progress', () => {
  it('presents the simplified internal workflow', () => {
    expect(getProjectProgress({ ...base, workflow_stage: 'PLANNED' })).toMatchObject({ label: 'Planning', phaseIndex: 0 });
    expect(getProjectProgress({ ...base, workflow_stage: 'SCHEDULED' })).toMatchObject({ label: 'Ready for Work', phaseIndex: 1 });
    expect(getProjectProgress({ ...base, workflow_stage: 'IN_PROGRESS' })).toMatchObject({ label: 'In Progress', phaseIndex: 2 });
    expect(getProjectProgress({ ...base, workflow_stage: 'REVIEW' })).toMatchObject({ label: 'Review', phaseIndex: 3 });
    expect(getProjectProgress({ ...base, workflow_stage: 'COMPLETED', status: 'COMPLETED' })).toMatchObject({ label: 'Completed', phaseIndex: 4 });
  });

  it('shows unresolved internal procurement as the conditional second step', () => {
    expect(getProjectProgress({ ...base, workflow_stage: 'PLANNED', procurement: { status: 'PROPOSAL_REQUIRED' } })).toMatchObject({ label: 'Procuring', sublabel: 'Waiting for Proposal', phaseIndex: 1 });
    expect(getProjectProgress({ ...base, workflow_stage: 'PLANNED', procurement: { status: 'SUBMITTED' } })).toMatchObject({ label: 'Procuring', sublabel: 'Proposal Submitted', phaseIndex: 1 });
  });

  it('keeps the existing vendor preparation presentation', () => {
    for (const workflow_stage of ['FINDING_VENDOR', 'PROPOSAL', 'APPROVAL'] as const) {
      expect(getProjectProgress({ work_type: 'VENDOR', status: 'ACTIVE', workflow_stage })).toMatchObject({ label: 'Preparing', phaseIndex: 1 });
    }
  });

  it('localizes internal progress in Indonesian', () => {
    expect(getProjectProgress({ ...base, workflow_stage: 'SCHEDULED' }, 'id')).toMatchObject({
      label: 'Siap Dikerjakan',
      detail: 'Pekerjaan siap. Pembaruan progres pertama akan memulai pekerjaan.',
      phaseIndex: 1,
    });
  });
});
