import { describe, expect, it } from 'vitest';
import { getProjectProgress } from './work-order-progress';

const base = { work_type: 'INTERNAL' as const, status: 'ACTIVE' as const };

describe('project progress', () => {
  it('rolls detailed operational stages into five simple phases', () => {
    expect(getProjectProgress({ ...base, workflow_stage: 'PLANNED' })).toMatchObject({ label: 'Planned', percent: 10 });
    expect(getProjectProgress({ ...base, workflow_stage: 'SCHEDULED' })).toMatchObject({ label: 'Preparing', percent: 30 });
    expect(getProjectProgress({ ...base, workflow_stage: 'IN_PROGRESS' })).toMatchObject({ label: 'In progress', percent: 65 });
    expect(getProjectProgress({ ...base, workflow_stage: 'REVIEW' })).toMatchObject({ label: 'Checking', percent: 90 });
    expect(getProjectProgress({ ...base, workflow_stage: 'COMPLETED', status: 'COMPLETED' })).toMatchObject({ label: 'Completed', percent: 100 });
  });

  it('keeps vendor search, proposal, and approval inside the preparing phase', () => {
    for (const workflow_stage of ['FINDING_VENDOR', 'PROPOSAL', 'APPROVAL'] as const) {
      expect(getProjectProgress({ work_type: 'VENDOR', status: 'ACTIVE', workflow_stage })).toMatchObject({ label: 'Preparing', percent: 30 });
    }
  });

  it('localizes progress labels and details in Indonesian', () => {
    expect(getProjectProgress({ ...base, workflow_stage: 'IN_PROGRESS' }, 'id')).toMatchObject({
      label: 'Dikerjakan',
      detail: 'Tim yang ditugaskan sedang mengerjakan pekerjaan ini.',
      percent: 65,
    });
  });
});
