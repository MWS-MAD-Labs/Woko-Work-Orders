import { useState, type FormEvent } from 'react';
import { addMonths, endOfMonth, endOfWeek, format } from 'date-fns';
import { ArrowLeft, ArrowRight, Check, ExternalLink, FileUp, FolderSearch, RotateCcw, X } from 'lucide-react';
import { blockerCategories, evidenceRules, evidenceTypes, priorities, proposalDecisions, type EvidenceType, type ProposalDecision, type TaskCondition, type WorkflowStage } from '@woko/domain';
import { api, createIdempotencyKey, uploadWithProgress } from './api';
import type { CurrentUser, ReferenceData, WorkOrder } from './types';
import { translator, type Locale } from './i18n';
import { getProjectProgress } from './work-order-progress';
import { DriveBrowser, type DriveBrowserItem } from './DriveBrowser';
import { formatIdrCurrency, formatIdrInput, parseIdrInput } from './currency';

function Field({ label, required, children, hint }: { label: string; required?: boolean; children: React.ReactNode; hint?: string }) {
  return <label className="form-field"><span>{label}{required && <b aria-hidden="true"> *</b>}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function PeoplePicker({ users, selected, onChange, label }: { users: ReferenceData['users']; selected: string[]; onChange: (ids: string[]) => void; label: string }) {
  return <fieldset className="people-picker"><legend>{label}</legend>{users.map((user) => <label key={user.id}><input type="checkbox" checked={selected.includes(user.id)} onChange={(event) => onChange(event.target.checked ? [...selected, user.id] : selected.filter((id) => id !== user.id))} /><span><strong>{user.full_name}</strong><small>{user.email}</small></span></label>)}</fieldset>;
}

const defaultOptionLabels: Record<string, string> = {
  INTERNAL: 'Internal', VENDOR: 'Vendor', BUILDING_STRUCTURE: 'Building Structure', PAINTING: 'Painting', DOORS_AND_WINDOWS: 'Doors and Windows',
  ELECTRICAL: 'Electrical', PLUMBING: 'Plumbing', AIR_CONDITIONING: 'Air Conditioning', FURNITURE: 'Furniture',
  SAFETY_AND_SECURITY: 'Safety and Security', OUTDOOR_AREAS: 'Outdoor Areas', RENOVATION: 'Renovation', OTHER: 'Other',
  NO_RESTRICTION: 'No Restriction', AFTER_SCHOOL_HOURS: 'After School Hours', WEEKEND_ONLY: 'Weekend Only',
  SCHOOL_HOLIDAY_ONLY: 'School Holiday Only', REQUIRES_AREA_CLOSURE: 'Requires Area Closure', CUSTOM_RESTRICTION: 'Custom Restriction',
};

const indonesianOptionLabels: Record<string, string> = {
  INTERNAL: 'Internal', VENDOR: 'Vendor', BUILDING_STRUCTURE: 'Struktur Gedung', PAINTING: 'Pengecatan', DOORS_AND_WINDOWS: 'Pintu dan Jendela',
  ELECTRICAL: 'Kelistrikan', PLUMBING: 'Perpipaan', AIR_CONDITIONING: 'Pendingin Udara', FURNITURE: 'Furnitur',
  SAFETY_AND_SECURITY: 'Keselamatan dan Keamanan', OUTDOOR_AREAS: 'Area Luar Ruangan', RENOVATION: 'Renovasi', OTHER: 'Lainnya',
  NO_RESTRICTION: 'Tanpa Pembatasan', AFTER_SCHOOL_HOURS: 'Setelah Jam Sekolah', WEEKEND_ONLY: 'Hanya Akhir Pekan',
  SCHOOL_HOLIDAY_ONLY: 'Hanya Libur Sekolah', REQUIRES_AREA_CLOSURE: 'Memerlukan Penutupan Area', CUSTOM_RESTRICTION: 'Pembatasan Khusus',
};

const priorityLabels: Record<Locale, Record<string, string>> = {
  id: { CRITICAL: 'Kritis', HIGH: 'Tinggi', NORMAL: 'Normal', LOW: 'Rendah' },
  en: { CRITICAL: 'Critical', HIGH: 'High', NORMAL: 'Normal', LOW: 'Low' },
};

function optionLabel(code: string, configuredLabel: string, locale: Locale) {
  return locale === 'id' && defaultOptionLabels[code] === configuredLabel ? indonesianOptionLabels[code] ?? configuredLabel : configuredLabel;
}

function locationTypeLabel(value: string, locale: Locale) {
  const normalized = value.replaceAll('_', ' ');
  if (locale !== 'id') return normalized;
  const translated: Record<string, string> = { FLOOR: 'Lantai', ROOM: 'Ruangan', AREA: 'Area', ZONE: 'Zona', WING: 'Sayap' };
  return translated[value] ?? normalized;
}

interface CreateFormProps {
  references: ReferenceData;
  currentUser: CurrentUser;
  onClose: () => void;
  onCreated: (id: string, number: string) => Promise<void> | void;
  locale: Locale;
}

export function CreateWorkOrderForm({ references, currentUser, onClose, onCreated, locale }: CreateFormProps) {
  const t = translator(locale);
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey] = useState(createIdempotencyKey);
  const firstCampus = references.campuses[0]?.id ?? '';
  const categoryOptions = references.workOptions.filter((option) => option.option_type === 'CATEGORY');
  const workTypeOptions = references.workOptions.filter((option) => option.option_type === 'WORK_TYPE');
  const executionWindowOptions = references.workOptions.filter((option) => option.option_type === 'EXECUTION_WINDOW');
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [data, setData] = useState({
    title: '', description: '', category: categoryOptions[0]?.code ?? '', priority: 'NORMAL', campusId: firstCampus,
    buildingId: references.buildings.find((building) => building.campus_id === firstCampus)?.id ?? '', locationOptionId: '', floor: '', roomOrArea: '',
    reviewerId: '', workType: workTypeOptions[0]?.code ?? 'INTERNAL', dueDate: '', plannedStartDate: '', procurementRequired: '', procurementRequirementNote: '',
    executionWindow: executionWindowOptions[0]?.code ?? '', executionWindowNote: '', planSummary: '',
  });
  const picUsers = references.users.filter((user) => user.roles.includes('PERSON_IN_CHARGE'));
  const workerUsers = references.users.filter((user) => user.roles.includes('WORKER'));
  const reviewerUsers = references.users.filter((user) => user.roles.some((role) => role === 'ADMINISTRATOR' || role === 'FACILITIES_MANAGER'));
  const overseerUsers = references.users.filter((user) => user.roles.includes('OVERSEER'));
  const currentPic = picUsers.find((user) => user.id === currentUser.id);
  const [assigneeIds, setAssigneeIds] = useState<string[]>(currentPic ? [currentPic.id] : picUsers[0] ? [picUsers[0].id] : []);
  const [workerIds, setWorkerIds] = useState<string[]>([]);
  const [overseerIds, setOverseerIds] = useState<string[]>([]);
  const set = (key: string, value: string) => setData((current) => ({ ...current, [key]: value }));
  const changeAssignees = (ids: string[]) => {
    setAssigneeIds(ids);
    setWorkerIds((current) => current.filter((id) => !ids.includes(id)));
    setOverseerIds((current) => current.filter((id) => !ids.includes(id)));
    setData((current) => ({ ...current, reviewerId: ids.includes(current.reviewerId) ? '' : current.reviewerId }));
  };
  const changeWorkers = (ids: string[]) => {
    setWorkerIds(ids);
    setAssigneeIds((current) => current.filter((id) => !ids.includes(id)));
    setOverseerIds((current) => current.filter((id) => !ids.includes(id)));
    setData((current) => ({ ...current, reviewerId: ids.includes(current.reviewerId) ? '' : current.reviewerId }));
  };
  const changeReviewer = (id: string) => {
    setData((current) => ({ ...current, reviewerId: id }));
    if (id) { setAssigneeIds((current) => current.filter((userId) => userId !== id)); setWorkerIds((current) => current.filter((userId) => userId !== id)); setOverseerIds((current) => current.filter((userId) => userId !== id)); }
  };
  const changeOverseers = (ids: string[]) => {
    setOverseerIds(ids);
    setAssigneeIds((current) => current.filter((id) => !ids.includes(id)));
    setWorkerIds((current) => current.filter((id) => !ids.includes(id)));
    setData((current) => ({ ...current, reviewerId: ids.includes(current.reviewerId) ? '' : current.reviewerId }));
  };
  const buildings = references.buildings.filter((building) => building.campus_id === data.campusId);
  const buildingLocationOptions = references.locationOptions.filter((option) => option.building_id === data.buildingId);
  const locationLevels: Array<{ options: typeof buildingLocationOptions; selectedId: string }> = [];
  let locationParentId: string | null = null;
  for (let depth = 0; depth <= selectedLocationIds.length; depth += 1) {
    const options = buildingLocationOptions.filter((option) => option.parent_id === locationParentId);
    if (!options.length) break;
    const selectedId = selectedLocationIds[depth] ?? '';
    locationLevels.push({ options, selectedId });
    if (!selectedId) break;
    locationParentId = selectedId;
  }

  const selectLocation = (depth: number, id: string) => {
    const nextIds = [...selectedLocationIds.slice(0, depth), ...(id ? [id] : [])];
    const selectedOptions = nextIds.map((selectedId) => buildingLocationOptions.find((option) => option.id === selectedId)).filter((option) => option !== undefined);
    setSelectedLocationIds(nextIds);
    setData((current) => ({ ...current, locationOptionId: nextIds.at(-1) ?? '', roomOrArea: selectedOptions.map((option) => option.name).join(' · '), floor: selectedOptions.find((option) => option.type_label === 'FLOOR')?.name ?? '' }));
  };
  const setDuePreset = (preset: string) => {
    const today = new Date();
    const period = references.periods.find((item) => item.type === preset);
    const due = preset === 'WEEK' ? endOfWeek(today, { weekStartsOn: 1 })
      : preset === 'MONTH' ? endOfMonth(today)
      : preset === 'NEXT_MONTH' ? endOfMonth(addMonths(today, 1))
      : period ? new Date(`${period.end_date}T00:00:00`) : today;
    set('dueDate', format(due, 'yyyy-MM-dd'));
  };
  const nextStep = () => {
    const requiredByStep = [
      [[data.title, t('title')], [data.description, t('description')], [data.category, t('category')], [data.workType, t('workType')]],
      [[data.campusId, t('campus')], [data.buildingId, t('building')]],
      [[assigneeIds[0], t('pic')], [data.executionWindow === 'CUSTOM_RESTRICTION' ? data.executionWindowNote : 'ok', t('restrictionNote')]],
      [[data.dueDate, t('dueDate')], [data.planSummary, t('planSummary')], [data.workType === 'INTERNAL' ? data.procurementRequired : 'ok', locale === 'id' ? 'Kebutuhan pengadaan' : 'Procurement choice'], [data.workType === 'INTERNAL' && data.procurementRequired === 'true' ? data.procurementRequirementNote : 'ok', locale === 'id' ? 'Deskripsi pengadaan' : 'Procurement description']],
    ];
    const missing = requiredByStep[step]?.find(([value]) => !String(value).trim());

    if (missing) {
      setError(`${missing[1]} ${t('isRequired')}`);
      return;
    }
    if (step === 2 && data.reviewerId && assigneeIds.includes(data.reviewerId)) {
      setError(t('reviewerPicConflict'));
      return;
    }
    if (step === 0 && (data.title.trim().length < 3 || data.description.trim().length < 10)) {
      setError(t('titleDescriptionMinimum'));
      return;
    }
    setError('');
    setStep((current) => current + 1);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (data.reviewerId && assigneeIds.includes(data.reviewerId)) throw new Error(t('reviewerPicConflict'));
      const normalizedData = { ...data, procurementRequired: data.workType === 'INTERNAL' ? data.procurementRequired === 'true' : undefined, procurementRequirementNote: data.workType === 'INTERNAL' && data.procurementRequired === 'true' ? data.procurementRequirementNote : undefined };
      const body = { ...Object.fromEntries(Object.entries(normalizedData).filter(([, value]) => value !== '' && value !== undefined)), assigneeIds, workerIds, overseerIds };
      const result = await api<{ id: string; number: string }>('/work-orders', {
        method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': idempotencyKey },
      });
      await onCreated(result.id, result.number);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('workOrderCreateFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const sections = [
    <div className="form-grid" key="basic">
      <Field label={t('title')} required><input value={data.title} onChange={(event) => set('title', event.target.value)} minLength={3} required /></Field>
      <Field label={t('category')} required><select value={data.category} onChange={(event) => set('category', event.target.value)}>{categoryOptions.map((option) => <option key={option.code} value={option.code}>{optionLabel(option.code, option.label, locale)}</option>)}</select></Field>
      <Field label={t('description')} required><textarea value={data.description} onChange={(event) => set('description', event.target.value)} minLength={10} rows={5} required /></Field>
      <Field label={t('priority')} required><select value={data.priority} onChange={(event) => set('priority', event.target.value)}>{priorities.map((priority) => <option key={priority} value={priority}>{priorityLabels[locale][priority]}</option>)}</select></Field>
      <Field label={t('workType')} required><select value={data.workType} onChange={(event) => { const workType = event.target.value; set('workType', workType); if (workType === 'VENDOR') setWorkerIds([]); }}>{workTypeOptions.map((option) => <option key={option.code} value={option.code}>{optionLabel(option.code, option.label, locale)}</option>)}</select></Field>
      {data.workType === 'VENDOR' && <small>Vendor work does not use internal workers.</small>}
    </div>,
    <div className="form-grid" key="location">
      <Field label={t('campus')} required><select value={data.campusId} onChange={(event) => { const campusId = event.target.value; const buildingId = references.buildings.find((building) => building.campus_id === campusId)?.id ?? ''; setSelectedLocationIds([]); setData((current) => ({ ...current, campusId, buildingId, locationOptionId: '', floor: '', roomOrArea: '' })); }}>{references.campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}</option>)}</select></Field>
      <Field label={t('building')} required><select value={data.buildingId} onChange={(event) => { setSelectedLocationIds([]); setData((current) => ({ ...current, buildingId: event.target.value, locationOptionId: '', floor: '', roomOrArea: '' })); }}>{buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}</select></Field>
      {locationLevels.map((level, depth) => <Field key={`${depth}-${level.options[0]?.parent_id ?? 'root'}`} label={level.options[0] ? locationTypeLabel(level.options[0].type_label, locale) : t('location')}><select value={level.selectedId} onChange={(event) => selectLocation(depth, event.target.value)}><option value="">{depth === 0 ? t('wholeBuilding') : t('wholePreviousLevel')}</option>{level.options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></Field>)}
      {!buildingLocationOptions.length && <div className="building-location-note"><strong>{t('buildingWideWorkOrder')}</strong><p>{t('noBuildingLocations')}</p></div>}
      {buildingLocationOptions.length > 0 && <p className="configured-location-summary"><strong>{t('selectedLocation')}</strong> {data.roomOrArea || t('wholeBuilding')}</p>}
    </div>,
    <div className="form-grid" key="responsibility">
      <PeoplePicker users={picUsers} selected={assigneeIds} onChange={changeAssignees} label={`${t('pic')} *`} />
      {data.workType === 'INTERNAL' && <PeoplePicker users={workerUsers} selected={workerIds} onChange={changeWorkers} label="Workers" />}
      <Field label={t('reviewer')}><select value={data.reviewerId} onChange={(event) => changeReviewer(event.target.value)}><option value="">{t('defaultManager')}</option>{reviewerUsers.map((user) => <option key={user.id} value={user.id}>{user.full_name}</option>)}</select></Field>
      <PeoplePicker users={overseerUsers} selected={overseerIds} onChange={changeOverseers} label={t('overseers')} />
      <Field label={t('executionWindow')}><select value={data.executionWindow} onChange={(event) => set('executionWindow', event.target.value)}>{executionWindowOptions.map((option) => <option key={option.code} value={option.code}>{optionLabel(option.code, option.label, locale)}</option>)}</select></Field>
      {data.executionWindow === 'CUSTOM_RESTRICTION' && <Field label={t('restrictionNote')} required><textarea value={data.executionWindowNote} onChange={(event) => set('executionWindowNote', event.target.value)} required /></Field>}
    </div>,
    <div className="form-grid" key="schedule">
      <Field label={t('dueDate')} required hint={t('exactDueDateHint')}><input type="date" value={data.dueDate} min={format(new Date(), 'yyyy-MM-dd')} onChange={(event) => set('dueDate', event.target.value)} required /></Field>
      <div className="preset-row"><button type="button" onClick={() => setDuePreset('WEEK')}>{t('thisWeek')}</button><button type="button" onClick={() => setDuePreset('MONTH')}>{t('thisMonth')}</button><button type="button" onClick={() => setDuePreset('NEXT_MONTH')}>{t('nextMonth')}</button><button type="button" onClick={() => setDuePreset('SEMESTER')}>{t('semester')}</button><button type="button" onClick={() => setDuePreset('ACADEMIC_YEAR')}>{t('academicYear')}</button></div>
      <Field label={t('plannedStartDate')}><input type="date" value={data.plannedStartDate} onChange={(event) => set('plannedStartDate', event.target.value)} /></Field>
      {data.workType === 'INTERNAL' && <Field label={locale === 'id' ? 'Apakah pekerjaan ini memerlukan pengadaan?' : 'Does this work require procurement?'} required><select value={data.procurementRequired} onChange={(event) => { set('procurementRequired', event.target.value); if (event.target.value !== 'true') set('procurementRequirementNote', ''); }} required><option value="">{locale === 'id' ? 'Pilih jawaban' : 'Choose an answer'}</option><option value="false">{locale === 'id' ? 'Tidak — langsung siap dikerjakan' : 'No — ready for work immediately'}</option><option value="true">{locale === 'id' ? 'Ya — mulai proses pengadaan' : 'Yes — start procurement'}</option></select></Field>}
      {data.workType === 'INTERNAL' && data.procurementRequired === 'true' && <Field label={locale === 'id' ? 'Apa yang perlu diadakan?' : 'What must be procured?'} required><textarea rows={3} value={data.procurementRequirementNote} onChange={(event) => set('procurementRequirementNote', event.target.value)} minLength={3} required /></Field>}
      <Field label={t('planSummary')} required><textarea rows={5} value={data.planSummary} onChange={(event) => set('planSummary', event.target.value)} minLength={3} required /></Field>
    </div>,
    <div className="review-summary" key="review">
      <h3>{data.title || t('untitledWorkOrder')}</h3><p>{data.description}</p>
      <dl><div><dt>{t('category')}</dt><dd>{(() => { const option = categoryOptions.find((item) => item.code === data.category); return option ? optionLabel(option.code, option.label, locale) : data.category; })()}</dd></div><div><dt>{t('workType')}</dt><dd>{(() => { const option = workTypeOptions.find((item) => item.code === data.workType); return option ? optionLabel(option.code, option.label, locale) : data.workType; })()}</dd></div>{data.workType === 'INTERNAL' && <div><dt>{locale === 'id' ? 'Pengadaan' : 'Procurement'}</dt><dd>{data.procurementRequired === 'true' ? (locale === 'id' ? 'Diperlukan' : 'Required') : (locale === 'id' ? 'Tidak diperlukan' : 'Not required')}</dd></div>}<div><dt>{t('dueDate')}</dt><dd>{data.dueDate}</dd></div><div><dt>{t('location')}</dt><dd>{references.buildings.find((building) => building.id === data.buildingId)?.name}, {data.roomOrArea || t('wholeBuilding')}</dd></div></dl>
    </div>,
  ];
  const stepNames = [t('basic'), t('location'), t('responsibility'), t('schedule'), t('reviewStep')];
  return <form className="sheet" onSubmit={submit}>
    <header className="sheet-header"><div><span>{t('newWorkOrder')}</span><h2>{stepNames[step]}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label={t('close')}><X /></button></header>
    <div className="stepper" aria-label={`${t('step')} ${step + 1} ${t('of')} ${sections.length}`}>{stepNames.map((name, index) => <span key={name} className={index <= step ? 'active' : ''}>{index < step ? <Check /> : index + 1}<small>{name}</small></span>)}</div>
    <div className="sheet-content">{sections[step]}{error && <p className="form-error" role="alert">{error}</p>}</div>
    <footer className="sheet-actions"><button type="button" className="secondary-button" disabled={step === 0 || submitting} onClick={() => { setError(''); setStep((current) => current - 1); }}><ArrowLeft /> {t('back')}</button>{step < sections.length - 1 ? <button type="button" className="primary-button" onClick={nextStep}>{t('next')} <ArrowRight /></button> : <button type="submit" className="primary-button" disabled={submitting}>{submitting ? t('creating') : t('createWorkOrder')}</button>}</footer>
  </form>;
}

export function ParticipantsActionForm({ order, references, locale, onClose, onChanged }: { order: WorkOrder; references: ReferenceData; locale: Locale; onClose: () => void; onChanged: () => Promise<void> | void }) {
  const t = translator(locale);
  const picUsers = references.users.filter((user) => user.roles.includes('PERSON_IN_CHARGE'));
  const workerUsers = references.users.filter((user) => user.roles.includes('WORKER'));
  const reviewerUsers = references.users.filter((user) => user.roles.some((role) => role === 'ADMINISTRATOR' || role === 'FACILITIES_MANAGER'));
  const overseerUsers = references.users.filter((user) => user.roles.includes('OVERSEER'));
  const [assigneeIds, setAssigneeIds] = useState(order.assignees.map((person) => person.id));
  const [workerIds, setWorkerIds] = useState(order.workers.map((person) => person.id));
  const [reviewerId, setReviewerId] = useState(order.reviewer_id ?? '');
  const [overseerIds, setOverseerIds] = useState(order.overseers.map((person) => person.id));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const changeAssignees = (ids: string[]) => {
    setAssigneeIds(ids);
    setWorkerIds((current) => current.filter((id) => !ids.includes(id)));
    setOverseerIds((current) => current.filter((id) => !ids.includes(id)));
    setReviewerId((current) => ids.includes(current) ? '' : current);
  };
  const changeWorkers = (ids: string[]) => {
    setWorkerIds(ids);
    setAssigneeIds((current) => current.filter((id) => !ids.includes(id)));
    setOverseerIds((current) => current.filter((id) => !ids.includes(id)));
    setReviewerId((current) => ids.includes(current) ? '' : current);
  };
  const changeReviewer = (id: string) => {
    setReviewerId(id);
    if (id) { setAssigneeIds((current) => current.filter((userId) => userId !== id)); setWorkerIds((current) => current.filter((userId) => userId !== id)); setOverseerIds((current) => current.filter((userId) => userId !== id)); }
  };
  const changeOverseers = (ids: string[]) => {
    setOverseerIds(ids);
    setAssigneeIds((current) => current.filter((id) => !ids.includes(id)));
    setWorkerIds((current) => current.filter((id) => !ids.includes(id)));
    setReviewerId((current) => ids.includes(current) ? '' : current);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!assigneeIds.length) { setError(t('picRequired')); return; }
    if (reviewerId && assigneeIds.includes(reviewerId)) { setError(t('reviewerPicConflict')); return; }
    setSubmitting(true); setError('');
    try {
      await api(`/work-orders/${order.id}/participants`, { method: 'PATCH', body: JSON.stringify({ assigneeIds, workerIds, reviewerId: reviewerId || null, overseerIds, reason, expectedVersion: order.version }) });
      await onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : t('participantsUpdateFailed')); }
    finally { setSubmitting(false); }
  };
  return <form className="action-panel" onSubmit={submit}>
    <header><div><span>{t('managerAction')}</span><h3>{t('editParticipants')}</h3></div><button type="button" className="icon-button" onClick={onClose}><X /></button></header>
    <div className="form-grid compact">
      <PeoplePicker users={picUsers} selected={assigneeIds} onChange={changeAssignees} label={`${t('pic')} *`} />
      {order.work_type === 'INTERNAL' && <PeoplePicker users={workerUsers} selected={workerIds} onChange={changeWorkers} label="Workers" />}
      <Field label={t('reviewer')}><select value={reviewerId} onChange={(event) => changeReviewer(event.target.value)}><option value="">{t('defaultManager')}</option>{reviewerUsers.map((user) => <option key={user.id} value={user.id}>{user.full_name}</option>)}</select></Field>
      <PeoplePicker users={overseerUsers} selected={overseerIds} onChange={changeOverseers} label={t('overseers')} />
      <Field label={t('reasonForChange')} required><textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} required /></Field>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <footer><button className="primary-button" disabled={submitting}>{submitting ? t('saving') : t('saveParticipants')}</button></footer>
  </form>;
}

interface WorkflowFormProps {
  order: WorkOrder;
  currentUser: CurrentUser;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
  locale?: Locale;
  initialAction?: 'forward' | 'reject' | 'reopen';
}

export function ConditionActionForm({ order, locale, onClose, onChanged }: Omit<WorkflowFormProps, 'currentUser'> & { locale: Locale }) {
  const copy = locale === 'id'
    ? { title: 'Laporkan masalah', section: 'Kondisi proyek', intro: 'Sampaikan kepada tim hanya informasi yang diperlukan untuk memahami masalah.', attention: 'Perlu perhatian', blocked: 'Tidak dapat dilanjutkan', resolved: 'Masalah terselesaikan', blockerCategory: 'Kategori hambatan', happening: 'Apa yang terjadi?', impact: 'Jelaskan secara singkat masalah dan dampaknya.', resolutionDate: 'Perkiraan tanggal penyelesaian', resolvedHow: 'Bagaimana masalah ini diselesaikan?', saving: 'Menyimpan...', resolve: 'Selesaikan kondisi', mark: 'Tandai' }
    : { title: 'Report an issue', section: 'Project condition', intro: 'Tell the team only what they need to know to understand the issue.', attention: 'Needs attention', blocked: 'Cannot continue', resolved: 'Issue resolved', blockerCategory: 'Blocker category', happening: 'What is happening?', impact: 'Briefly explain the issue and its likely impact.', resolutionDate: 'Expected resolution date', resolvedHow: 'How was the issue resolved?', saving: 'Saving...', resolve: 'Resolve condition', mark: 'Mark' };
  const [condition, setCondition] = useState<TaskCondition>(order.condition === 'ON_TRACK' ? 'AT_RISK' : 'ON_TRACK');
  const [explanation, setExplanation] = useState('');
  const [expectedImpact, setExpectedImpact] = useState('');
  const [blockerCategory, setBlockerCategory] = useState<(typeof blockerCategories)[number]>('DEPENDENCY');
  const [expectedResolutionDate, setExpectedResolutionDate] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setSubmitting(true);
    try {
      const body = condition === 'AT_RISK'
        ? { condition, explanation, expectedImpact: expectedImpact || explanation, expectedVersion: order.version }
        : condition === 'BLOCKED'
          ? { condition, blockerCategory, explanation, expectedResolutionDate, expectedVersion: order.version }
          : { condition, resolutionNote, expectedVersion: order.version };
      await api(`/work-orders/${order.id}/condition`, { method: 'POST', body: JSON.stringify(body) });
      await onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : (locale === 'id' ? 'Kondisi tidak dapat diubah.' : 'Condition could not be changed.')); } finally { setSubmitting(false); }
  };
  return <form className="action-panel" onSubmit={submit}>
    <header><div><span>{copy.section}</span><h3>{copy.title}</h3><p className="action-intro">{copy.intro}</p></div><button type="button" className="icon-button" onClick={onClose}><X /></button></header>
    <div className="segmented-control">
      {order.condition !== 'AT_RISK' && <button type="button" className={condition === 'AT_RISK' ? 'active' : ''} onClick={() => setCondition('AT_RISK')}>{copy.attention}</button>}
      {order.condition !== 'BLOCKED' && <button type="button" className={condition === 'BLOCKED' ? 'active' : ''} onClick={() => setCondition('BLOCKED')}>{copy.blocked}</button>}
      {order.condition !== 'ON_TRACK' && <button type="button" className={condition === 'ON_TRACK' ? 'active' : ''} onClick={() => setCondition('ON_TRACK')}>{copy.resolved}</button>}
    </div>
    <div className="form-grid compact">
      {condition === 'BLOCKED' && <Field label={copy.blockerCategory} required><select value={blockerCategory} onChange={(event) => setBlockerCategory(event.target.value as typeof blockerCategory)}>{blockerCategories.map((category) => <option key={category} value={category}>{category.replaceAll('_', ' ')}</option>)}</select></Field>}
      {(condition === 'AT_RISK' || condition === 'BLOCKED') && <Field label={copy.happening} required hint={copy.impact}><textarea rows={4} value={explanation} onChange={(event) => { setExplanation(event.target.value); setExpectedImpact(event.target.value); }} minLength={3} required /></Field>}
      {condition === 'BLOCKED' && <Field label={copy.resolutionDate} required><input type="date" value={expectedResolutionDate} onChange={(event) => setExpectedResolutionDate(event.target.value)} required /></Field>}
      {condition === 'ON_TRACK' && <Field label={copy.resolvedHow} required><textarea rows={4} value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} minLength={3} required /></Field>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <footer><button className="primary-button" disabled={submitting}>{submitting ? copy.saving : condition === 'ON_TRACK' ? copy.resolve : `${copy.mark} ${condition.replaceAll('_', ' ').toLowerCase()}`}</button></footer>
  </form>;
}

export function DueDateActionForm({ order, locale, onClose, onChanged }: Omit<WorkflowFormProps, 'currentUser'> & { locale: Locale }) {
  const copy = locale === 'id'
    ? { newDate: 'Tanggal tenggat baru', reason: 'Alasan perubahan', saving: 'Menyimpan...', change: 'Ubah tanggal tenggat' }
    : { newDate: 'New due date', reason: 'Reason for change', saving: 'Saving...', change: 'Change due date' };
  const t = translator(locale);
  const [dueDate, setDueDate] = useState(order.due_date);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setSubmitting(true);
    try {
      await api(`/work-orders/${order.id}/due-date`, { method: 'PATCH', body: JSON.stringify({ dueDate, reason, expectedVersion: order.version }) });
      await onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : (locale === 'id' ? 'Tanggal tenggat tidak dapat diubah.' : 'Due date could not be changed.')); } finally { setSubmitting(false); }
  };
  return <form className="action-panel" onSubmit={submit}>
    <header><div><span>{t('managerAction')}</span><h3>{copy.change}</h3></div><button type="button" className="icon-button" onClick={onClose}><X /></button></header>
    <div className="form-grid compact">
      <Field label={copy.newDate} required><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required /></Field>
      <Field label={copy.reason} required><textarea rows={4} value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} required /></Field>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <footer><button className="primary-button" disabled={submitting || dueDate === order.due_date}>{submitting ? copy.saving : copy.change}</button></footer>
  </form>;
}

export function EvidencePanel({ order, currentUser, onChanged }: Pick<WorkflowFormProps, 'order' | 'currentUser' | 'onChanged'>) {
  const isManager = currentUser.roles.some((role) => role === 'ADMINISTRATOR' || role === 'FACILITIES_MANAGER');
  const canUpload = false;
  const [evidenceType, setEvidenceType] = useState<EvidenceType>('PROGRESS');
  const [file, setFile] = useState<File | null>(null);
  const [showDriveBrowser, setShowDriveBrowser] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const retry = async () => {
    setError(''); setSubmitting(true);
    try { await api(`/work-orders/${order.id}/drive/retry`, { method: 'POST' }); await onChanged(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Provisioning retry failed.'); }
    finally { setSubmitting(false); }
  };
  const upload = async () => {
    if (!file) return;
    setError(''); setSubmitting(true); setProgress(0);
    try {
      const data = new FormData();
      data.append('evidenceType', evidenceType);
      data.append('expectedVersion', String(order.version));
      data.append('file', file);
      await uploadWithProgress(`/work-orders/${order.id}/attachments/upload`, data, setProgress);
      setFile(null); setProgress(100); await onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Upload failed.'); }
    finally { setSubmitting(false); }
  };
  const transferFromDrive = async (selected: DriveBrowserItem, accessToken: string) => {
    if (!window.confirm(`Link “${selected.name}” to this project?\n\nWoko will share edit access with everyone on this work card and create a shortcut in the private project folder. The original file will not be moved or copied.`)) return;
    setShowDriveBrowser(false); setError(''); setSubmitting(true);
    try {
      await api(`/work-orders/${order.id}/attachments/drive-transfer`, { method: 'POST', headers: { 'X-Google-Drive-Token': accessToken }, body: JSON.stringify({ evidenceType, sourceDriveFileId: selected.id, expectedVersion: order.version }) });
      await onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Drive file could not be linked.'); }
    finally { setSubmitting(false); }
  };
  return <section className="evidence-section">
    <div className="evidence-heading"><div><h3>File evidence</h3><p>Initial, progress, proposal, and completion records are stored by Woko in a private work-order Drive folder.</p></div></div>
    <div className={`drive-status drive-status-${order.drive_provisioning_status.toLowerCase()}`}><strong>Google Drive: {order.drive_provisioning_status}</strong>{order.drive_provisioning_error && <span>{order.drive_provisioning_error}</span>}{order.drive_provisioning_status === 'FAILED' && isManager && <button type="button" className="secondary-button" onClick={retry} disabled={submitting}><RotateCcw /> Retry</button>}</div>
    {canUpload && order.drive_provisioning_status === 'COMPLETE' && <div className="evidence-controls">
      <Field label="Evidence type"><select value={evidenceType} onChange={(event) => setEvidenceType(event.target.value as EvidenceType)}>{evidenceTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></Field>
      <div className="upload-row"><label className="file-picker"><FileUp /><span>{file?.name ?? 'Choose file'}</span><input type="file" accept={evidenceRules.allowedExtensions.map((extension) => `.${extension}`).join(',')} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label><button type="button" className="primary-button" onClick={upload} disabled={!file || submitting}>Upload</button></div>
      {submitting && progress > 0 && <div className="upload-progress" aria-label={`Upload ${progress}%`}><span style={{ width: `${progress}%` }} /></div>}
      <button type="button" className="drive-browse-button" onClick={() => setShowDriveBrowser(true)} disabled={submitting}><FolderSearch /> Choose from Google Drive <small>Share with the Woko Drive worker and create a private project shortcut</small></button>
      <small>Your original file stays in place. Everyone on the work card receives edit access; the Drive worker maintains that editor list and stores a shortcut in the private project folder. Maximum {evidenceRules.maxFilesPerType} files per evidence type and {Math.round(evidenceRules.maxFileSizeBytes / 1024 / 1024)} MB per uploaded file.</small>
    </div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="evidence-list">{order.attachments?.length ? order.attachments.map((attachment) => <a key={attachment.id} href={attachment.drive_url} target="_blank" rel="noreferrer"><span><strong>{attachment.file_name}</strong><small>{attachment.evidence_type} · {attachment.source_type === 'UPLOAD' ? 'Uploaded' : attachment.source_type === 'DRIVE_SHORTCUT' ? 'Drive shortcut' : attachment.source_type === 'DRIVE_MOVE' ? 'Transferred from My Drive' : 'Copied from Drive'} · {attachment.uploaded_by}</small></span><ExternalLink /></a>) : <p className="muted">No file evidence added yet.</p>}</div>
    {showDriveBrowser && <DriveBrowser onClose={() => setShowDriveBrowser(false)} onSelect={(selected, accessToken) => void transferFromDrive(selected, accessToken)} />}
  </section>;
}

export function InternalProcurementPanel({ order, currentUser, onChanged }: Pick<WorkflowFormProps, 'order' | 'currentUser' | 'onChanged'>) {
  const procurement = order.procurement;
  const isManager = currentUser.roles.some((role) => role === 'ADMINISTRATOR' || role === 'FACILITIES_MANAGER');
  const isPic = order.assignees.some((person) => person.id === currentUser.id);
  const canManage = isManager || isPic;
  const [file, setFile] = useState<File | null>(null);
  const [attachmentId, setAttachmentId] = useState<string | null>(null);
  const [workVersion, setWorkVersion] = useState(order.version);
  const [showDriveBrowser, setShowDriveBrowser] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  if (order.work_type !== 'INTERNAL' || !procurement) return null;

  const run = async (path: string, body: Record<string, unknown>) => {
    setSubmitting(true); setError('');
    try { await api(`/work-orders/${order.id}/procurement-proposal${path}`, { method: path === '' ? 'PATCH' : 'POST', body: JSON.stringify({ ...body, expectedVersion: workVersion, expectedProcurementVersion: procurement.version }) }); await onChanged(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Procurement action failed.'); }
    finally { setSubmitting(false); }
  };
  const uploadLocal = async () => {
    if (!file) return;
    setSubmitting(true); setError('');
    try {
      const data = new FormData();
      data.append('evidenceType', 'PROPOSAL'); data.append('attachmentContext', 'INTERNAL_PROCUREMENT'); data.append('expectedVersion', String(workVersion)); data.append('file', file);
      const result = await uploadWithProgress<{ id: string; version: number }>(`/work-orders/${order.id}/attachments/upload`, data, () => undefined);
      setAttachmentId(result.id); setWorkVersion(result.version); setFile(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Proposal upload failed.'); }
    finally { setSubmitting(false); }
  };
  const transferDrive = async (selected: DriveBrowserItem, accessToken: string) => {
    setShowDriveBrowser(false); setSubmitting(true); setError('');
    try {
      const result = await api<{ id: string; version: number }>(`/work-orders/${order.id}/attachments/drive-transfer`, { method: 'POST', headers: { 'X-Google-Drive-Token': accessToken }, body: JSON.stringify({ evidenceType: 'PROPOSAL', attachmentContext: 'INTERNAL_PROCUREMENT', sourceDriveFileId: selected.id, expectedVersion: workVersion }) });
      setAttachmentId(result.id); setWorkVersion(result.version);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Drive proposal could not be linked.'); }
    finally { setSubmitting(false); }
  };
  const documents = order.attachments?.filter((item) => item.attachment_context === 'INTERNAL_PROCUREMENT') ?? [];
  return <section className="evidence-section procurement-section">
    <div className="evidence-heading"><div><h3>Internal procurement</h3><p>Woko records submission to the external Finance process and its communicated decision.</p></div><strong>{procurement.status.replaceAll('_', ' ')}</strong></div>
    {procurement.requirement_note && <p>{procurement.requirement_note}</p>}
    {procurement.submitted_at && <small>Submitted by {procurement.submitted_by_name} · {new Date(procurement.submitted_at).toLocaleString()}</small>}
    {procurement.decision_note && <p><strong>Finance decision:</strong> {procurement.decision_note} — {procurement.decided_by_name}</p>}
    {documents.length > 0 && <div className="evidence-list">{documents.map((document) => <a key={document.id} href={document.drive_url} target="_blank" rel="noreferrer"><span><strong>{document.original_file_name ?? document.file_name}</strong><small>{document.uploaded_by}</small></span><ExternalLink /></a>)}</div>}
    {canManage && procurement.status === 'NOT_REQUIRED' && <button type="button" className="secondary-button" disabled={submitting} onClick={() => { const note = window.prompt('Why is procurement required?'); if (note) void run('/require', { requirementNote: note }); }}>Mark procurement required</button>}
    {canManage && procurement.status !== 'NOT_REQUIRED' && procurement.status !== 'APPROVED' && <div className="evidence-controls">
      <div className="upload-row"><label className="file-picker"><FileUp /><span>{file?.name ?? 'Upload procurement proposal'}</span><input type="file" accept={evidenceRules.allowedExtensions.map((extension) => `.${extension}`).join(',')} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label><button type="button" className="secondary-button" disabled={!file || submitting} onClick={() => void uploadLocal()}>Upload</button></div>
      <button type="button" className="drive-browse-button" disabled={submitting} onClick={() => setShowDriveBrowser(true)}><FolderSearch /> Choose from Google Drive</button>
      {(attachmentId || documents.length > 0) && ['PROPOSAL_REQUIRED', 'REVISION_REQUIRED'].includes(procurement.status) && <button type="button" className="primary-button" disabled={submitting} onClick={() => { if (window.confirm('I confirm that this proposal has been submitted through the external Finance process.')) void run('/submit', { attachmentIds: attachmentId ? [attachmentId] : documents.map((item) => item.id), confirmation: true }); }}>Record proposal submitted</button>}
      {procurement.status === 'REJECTED' && <button type="button" className="primary-button" disabled={submitting} onClick={() => { const note = window.prompt('Reason for the revised proposal', procurement.requirement_note ?? ''); if (note) void run('/require', { requirementNote: note }); }}>Start revised proposal</button>}
      <button type="button" className="secondary-button" disabled={submitting} onClick={() => { const note = window.prompt('Update procurement note', procurement.requirement_note ?? ''); if (note) void run('', { requirementNote: note }); }}>Update note</button>
      <button type="button" className="secondary-button" disabled={submitting} onClick={() => { const reason = window.prompt('Reason procurement is no longer required'); if (reason) void run('/clear', { reason }); }}>Mark no longer required</button>
    </div>}
    {isManager && procurement.status === 'SUBMITTED' && <div className="segmented-control">{(['APPROVED', 'REJECTED', 'REVISION_REQUIRED'] as const).map((decision) => <button type="button" key={decision} disabled={submitting} onClick={() => { const decisionNote = window.prompt(`Decision note for ${decision.replaceAll('_', ' ')}`); if (decisionNote) void run('/decision', { decision, decisionNote }); }}>{decision.replaceAll('_', ' ')}</button>)}</div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {showDriveBrowser && <DriveBrowser title="Choose procurement proposal" onClose={() => setShowDriveBrowser(false)} onSelect={(selected, accessToken) => void transferDrive(selected, accessToken)} />}
  </section>;
}

export function WorkflowActionForm({ order, currentUser, locale = 'en', onClose, onChanged, initialAction }: WorkflowFormProps) {
  const copy = locale === 'id'
    ? { reopenCompleted: 'Buka kembali pekerjaan selesai', finalCheck: 'Selesaikan pemeriksaan akhir', updateProgress: 'Perbarui progres proyek', progressIntro: 'Catat pembaruan yang sedang berjalan atau tandai pekerjaan sebagai selesai untuk dikirimkan ke pemeriksaan.', updateIntro: 'Tambahkan pembaruan singkat dan jelas. Woko akan memindahkan proyek ke tahap berikutnya yang dapat dilacak.', progressUpdate: 'Pembaruan progres', workCompleted: 'Pekerjaan selesai', approve: 'Setujui', reject: 'Tolak', reopen: 'Buka kembali', startDate: 'Kapan pekerjaan dimulai?', reason: 'Alasan', finalCheckNote: 'Catatan pemeriksaan akhir', completionNote: 'Catatan penyelesaian', shortUpdate: 'Pembaruan singkat', progressEvidence: 'Bukti progres', saving: 'Menyimpan...', rejectToProgress: 'Tolak kembali ke Dikerjakan', reopenWork: 'Buka kembali pekerjaan', saveProgress: 'Simpan pembaruan progres', markCompleted: 'Tandai pekerjaan selesai', approveCompletion: 'Setujui penyelesaian', confirmProgress: 'Konfirmasi progres' }
    : { reopenCompleted: 'Reopen completed work', finalCheck: 'Complete the final check', updateProgress: 'Update project progress', progressIntro: 'Record an ongoing update or mark the work as completed and send it for review.', updateIntro: 'Add a short, clear update. Woko will move the project to its next trackable phase.', progressUpdate: 'Progress update', workCompleted: 'Work completed', approve: 'Approve', reject: 'Reject', reopen: 'Reopen', startDate: 'When will work start?', reason: 'Reason', finalCheckNote: 'Final check note', completionNote: 'Completion note', shortUpdate: 'Short update', progressEvidence: 'Progress evidence', saving: 'Saving...', rejectToProgress: 'Reject back to In Progress', reopenWork: 'Reopen work order', saveProgress: 'Save progress update', markCompleted: 'Mark work completed', approveCompletion: 'Approve completion', confirmProgress: 'Confirm progress' };
  const isManager = currentUser.roles.some((role) => role === 'ADMINISTRATOR' || role === 'FACILITIES_MANAGER');
  const [action, setAction] = useState<'forward' | 'reject' | 'reopen'>(initialAction ?? (order.status === 'COMPLETED' ? 'reopen' : 'forward'));
  const [progressMode, setProgressMode] = useState<'mid' | 'complete'>('mid');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [plannedStartDate, setPlannedStartDate] = useState(order.planned_start_date ?? '');
  const [waiverReason, setWaiverReason] = useState('');
  const [progressImage, setProgressImage] = useState<File | null>(null);
  const [uploadedImageVersion, setUploadedImageVersion] = useState<number | null>(null);
  const [uploadedAttachmentId, setUploadedAttachmentId] = useState<string | null>(null);
  const [uploadedAsCompletion, setUploadedAsCompletion] = useState(false);
  const [showProgressDriveBrowser, setShowProgressDriveBrowser] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const stages = order.work_type === 'INTERNAL' ? ['PLANNED', 'SCHEDULED', 'IN_PROGRESS', 'REVIEW', 'COMPLETED'] : ['PLANNED', 'FINDING_VENDOR', 'PROPOSAL', 'APPROVAL', 'SCHEDULED', 'IN_PROGRESS', 'REVIEW', 'COMPLETED'];
  const stageIndex = stages.indexOf(order.workflow_stage);
  const nextStage = stages[stageIndex + 1] as WorkflowStage | undefined;
  const canReject = isManager && order.workflow_stage === 'REVIEW';
  const canReopen = isManager && order.status === 'COMPLETED';
  const isInProgressUpdate = order.work_type === 'INTERNAL' && ['SCHEDULED', 'IN_PROGRESS'].includes(order.workflow_stage) && action === 'forward';
  const isMidProgressUpdate = isInProgressUpdate && (order.workflow_stage === 'SCHEDULED' || progressMode === 'mid');
  const targetStage = action === 'reject' ? 'IN_PROGRESS' : isMidProgressUpdate ? 'IN_PROGRESS' : nextStage;
  const hasProposalEvidence = order.attachments?.some((attachment) => attachment.evidence_type === 'PROPOSAL') ?? false;
  const hasCompletionPhoto = order.attachments?.some((attachment) => attachment.evidence_type === 'COMPLETION' && attachment.mime_type.startsWith('image/')) ?? false;
  const selectedCompletionPhoto = Boolean(progressImage && (targetStage === 'REVIEW' || targetStage === 'COMPLETED'));
  const hasCompletionPhotoForSubmit = hasCompletionPhoto || selectedCompletionPhoto || uploadedAsCompletion;
  const canAttachProgressImage = action !== 'reopen' && order.drive_provisioning_status === 'COMPLETE';
  const vendorStructuredStage = order.work_type === 'VENDOR' && ['PLANNED', 'FINDING_VENDOR', 'PROPOSAL', 'APPROVAL'].includes(order.workflow_stage);
  const progress = getProjectProgress(order, locale);
  const selectProgressImage = (file: File | null) => {
    setUploadProgress(0);
    if (!file) { setProgressImage(null); return; }
    if (!evidenceRules.allowedMimeTypes.includes(file.type as (typeof evidenceRules.allowedMimeTypes)[number]) || !file.type.startsWith('image/')) {
      setProgressImage(null); setError('Choose a JPG, PNG, WebP, HEIC, or HEIF image.'); return;
    }
    if (file.size > evidenceRules.maxFileSizeBytes) {
      setProgressImage(null); setError(`Image must be smaller than ${Math.round(evidenceRules.maxFileSizeBytes / 1024 / 1024)} MB.`); return;
    }
    setError(''); setProgressImage(file);
  };
  const transferProgressDrive = async (selected: DriveBrowserItem, accessToken: string) => {
    setShowProgressDriveBrowser(false); setSubmitting(true); setError('');
    try {
      const context = isMidProgressUpdate ? 'PROGRESS_UPDATE' : 'COMPLETION';
      const evidenceType = isMidProgressUpdate ? 'PROGRESS' : 'COMPLETION';
      const result = await api<{ id: string; version: number }>(`/work-orders/${order.id}/attachments/drive-transfer`, { method: 'POST', headers: { 'X-Google-Drive-Token': accessToken }, body: JSON.stringify({ evidenceType, attachmentContext: context, sourceDriveFileId: selected.id, expectedVersion: order.version }) });
      setUploadedAttachmentId(result.id); setUploadedImageVersion(result.version); setUploadedAsCompletion(!isMidProgressUpdate);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Drive attachment could not be linked.'); }
    finally { setSubmitting(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setSubmitting(true);
    try {
      if (action === 'reopen') {
        await api(`/work-orders/${order.id}/reopen`, { method: 'POST', body: JSON.stringify({ reason, expectedVersion: order.version }) });
      } else {
        let expectedVersion = uploadedImageVersion ?? order.version;
        let attachmentId = uploadedAttachmentId;
        if (progressImage && uploadedImageVersion === null) {
          const data = new FormData();
          data.append('evidenceType', !isMidProgressUpdate && (targetStage === 'REVIEW' || targetStage === 'COMPLETED') ? 'COMPLETION' : 'PROGRESS');
          data.append('expectedVersion', String(expectedVersion));
          data.append('attachmentContext', isMidProgressUpdate ? 'PROGRESS_UPDATE' : 'COMPLETION');
          data.append('file', progressImage);
          const uploaded = await uploadWithProgress<{ id: string; version: number }>(`/work-orders/${order.id}/attachments/upload`, data, setUploadProgress);
          expectedVersion = uploaded.version;
          attachmentId = uploaded.id;
          setUploadedImageVersion(uploaded.version);
          setUploadedAttachmentId(uploaded.id);
          setUploadedAsCompletion(!isMidProgressUpdate && (targetStage === 'REVIEW' || targetStage === 'COMPLETED'));
          setProgressImage(null);
        }
        if (isMidProgressUpdate) {
          await api(`/work-orders/${order.id}/progress-update`, { method: 'POST', body: JSON.stringify({ note, expectedVersion, attachmentIds: attachmentId ? [attachmentId] : [] }) });
        } else if (order.work_type === 'INTERNAL' && targetStage === 'REVIEW') {
          await api(`/work-orders/${order.id}/submit-completion`, { method: 'POST', body: JSON.stringify({ note, expectedVersion, attachmentIds: attachmentId ? [attachmentId] : [] }) });
        } else {
          await api(`/work-orders/${order.id}/transitions`, { method: 'POST', body: JSON.stringify({ toStage: targetStage, note, reason: action === 'reject' ? reason : undefined, expectedVersion, plannedStartDate: targetStage === 'SCHEDULED' ? plannedStartDate : undefined, completionEvidenceWaiverReason: targetStage === 'COMPLETED' && !hasCompletionPhotoForSubmit ? waiverReason : undefined, attachmentIds: attachmentId ? [attachmentId] : [] }) });
        }
      }
      await onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : (locale === 'id' ? 'Tindakan tidak dapat diselesaikan.' : 'Action failed.')); } finally { setSubmitting(false); }
  };
  return <form className="action-panel" onSubmit={submit}>
    <header><div><span>{progress.label}{progress.sublabel ? ` · ${progress.sublabel}` : ''}</span><h3>{canReopen ? copy.reopenCompleted : order.workflow_stage === 'REVIEW' ? copy.finalCheck : order.workflow_stage === 'SCHEDULED' ? (locale === 'id' ? 'Mulai dengan pembaruan progres' : 'Start with a progress update') : copy.updateProgress}</h3><p className="action-intro">{order.workflow_stage === 'SCHEDULED' ? (locale === 'id' ? 'Pembaruan pertama otomatis memindahkan pekerjaan ini ke Dikerjakan.' : 'The first update automatically moves this work to In Progress.') : isInProgressUpdate ? (locale === 'id' ? 'Simpan pembaruan lain atau ajukan pekerjaan untuk peninjauan penyelesaian.' : 'Save another update or submit the work for completion review.') : copy.updateIntro}</p></div><button type="button" className="icon-button" onClick={onClose}><X /></button></header>
    {isInProgressUpdate && order.workflow_stage === 'IN_PROGRESS' && <div className="segmented-control progress-mode-control"><button type="button" className={progressMode === 'mid' ? 'active' : ''} disabled={uploadedImageVersion !== null} onClick={() => setProgressMode('mid')}>{locale === 'id' ? 'Tambah pembaruan progres' : 'Add progress update'}</button><button type="button" className={progressMode === 'complete' ? 'active' : ''} disabled={uploadedImageVersion !== null} onClick={() => setProgressMode('complete')}>{locale === 'id' ? 'Ajukan penyelesaian' : 'Submit for completion'}</button></div>}
    {(canReject || canReopen) && <div className="segmented-control">{order.status !== 'COMPLETED' && <button type="button" className={action === 'forward' ? 'active' : ''} onClick={() => setAction('forward')}>{copy.approve}</button>}{canReject && <button type="button" className={action === 'reject' ? 'active' : ''} onClick={() => setAction('reject')}>{copy.reject}</button>}{canReopen && <button type="button" className={action === 'reopen' ? 'active' : ''} onClick={() => setAction('reopen')}>{copy.reopen}</button>}</div>}
    {vendorStructuredStage && !isManager && <p className="form-error">Use the structured vendor action for this stage.</p>}
    <div className="form-grid compact">
      {targetStage === 'SCHEDULED' && <Field label={copy.startDate} required><input type="date" value={plannedStartDate} onChange={(event) => setPlannedStartDate(event.target.value)} required /></Field>}

      {order.workflow_stage === 'PROPOSAL' && targetStage === 'APPROVAL' && !hasProposalEvidence && <p className="form-error">{locale === 'id' ? 'Tambahkan setidaknya satu file proposal sebelum mengirimkan untuk persetujuan.' : 'Add at least one proposal file before submitting for approval.'}</p>}
      {targetStage === 'REVIEW' && order.procurement && !['NOT_REQUIRED', 'APPROVED'].includes(order.procurement.status) && <p className="form-error">{locale === 'id' ? 'Pengadaan harus disetujui atau ditandai tidak diperlukan sebelum penyelesaian dapat diajukan.' : 'Procurement must be approved or marked not required before completion can be submitted.'}</p>}
      {targetStage === 'COMPLETED' && !hasCompletionPhotoForSubmit && <Field label={locale === 'id' ? 'Alasan pengecualian manajer' : 'Manager waiver reason'} required hint={locale === 'id' ? 'Foto penyelesaian diperlukan. Manajer Fasilitas dapat memberikan pengecualian dengan alasan terdokumentasi.' : 'A completion photo is required. A Facilities Manager may waive it with a documented reason.'}><textarea rows={3} value={waiverReason} onChange={(event) => setWaiverReason(event.target.value)} required /></Field>}
      {targetStage === 'COMPLETED' && hasCompletionPhotoForSubmit && <p className="evidence-confirmation"><Check /> {progressImage ? (locale === 'id' ? 'Gambar yang dipilih akan dilampirkan sebagai bukti penyelesaian.' : 'The selected image will be attached as completion evidence.') : uploadedAsCompletion ? (locale === 'id' ? 'Gambar diunggah sebagai bukti penyelesaian.' : 'The image was uploaded as completion evidence.') : (locale === 'id' ? 'Bukti foto penyelesaian telah dilampirkan.' : 'Completion photo evidence is attached.')}</p>}
      {(action === 'reject' || action === 'reopen') && <Field label={copy.reason} required><textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} required /></Field>}
      {action !== 'reopen' && <Field label={targetStage === 'COMPLETED' ? copy.finalCheckNote : isMidProgressUpdate ? copy.progressUpdate : targetStage === 'REVIEW' ? (locale === 'id' ? 'Ringkasan penyelesaian' : 'Completion summary') : copy.shortUpdate} required hint={isMidProgressUpdate ? (locale === 'id' ? 'Contoh: Pemasangan telah dimulai; pekerjaan kelistrikan dilanjutkan besok.' : 'Example: Installation has started; electrical work continues tomorrow.') : targetStage === 'REVIEW' ? (locale === 'id' ? 'Konfirmasikan pekerjaan yang telah diselesaikan dan detail serah terima penting.' : 'Confirm what was completed and any important handover details.') : (locale === 'id' ? 'Contoh: Komponen telah tiba dan pemasangan dimulai Senin.' : 'Example: Parts arrived and installation starts Monday.')}><textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} minLength={3} required /></Field>}
      {canAttachProgressImage && uploadedImageVersion === null && <Field label={targetStage === 'REVIEW' || targetStage === 'COMPLETED' ? (locale === 'id' ? 'Foto penyelesaian' : 'Completion photo') : copy.progressEvidence} required={targetStage === 'REVIEW' && !hasCompletionPhoto} hint={targetStage === 'REVIEW' || targetStage === 'COMPLETED' ? (locale === 'id' ? 'Foto penyelesaian diperlukan sebelum pengajuan.' : 'A completion photo is required before submission.') : (locale === 'id' ? 'Bukti progres opsional.' : 'Optional progress evidence.')}><label className="file-picker progress-image-picker"><FileUp /><span>{progressImage?.name ?? (locale === 'id' ? 'Unggah dari perangkat' : 'Upload from device')}</span><input type="file" accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(event) => selectProgressImage(event.target.files?.[0] ?? null)} /></label><button type="button" className="drive-browse-button" onClick={() => setShowProgressDriveBrowser(true)}><FolderSearch /> {locale === 'id' ? 'Pilih dari Google Drive' : 'Choose from Google Drive'}</button></Field>}
      {uploadedImageVersion !== null && <p className="evidence-confirmation"><Check /> {locale === 'id' ? 'Gambar diunggah. Konfirmasikan progres untuk menyelesaikan pembaruan ini.' : 'Image uploaded. Confirm progress to finish this update.'}</p>}
      {action !== 'reopen' && order.drive_provisioning_status !== 'COMPLETE' && <p className="muted progress-image-unavailable">{locale === 'id' ? 'Gambar dapat ditambahkan setelah folder Drive proyek siap.' : 'Images can be added after the project Drive folder is ready.'}</p>}
      {submitting && uploadProgress > 0 && uploadProgress < 100 && <div className="upload-progress" aria-label={`Upload ${uploadProgress}%`}><span style={{ width: `${uploadProgress}%` }} /></div>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <footer><button className="primary-button" disabled={submitting || (!targetStage && action !== 'reopen') || vendorStructuredStage || (order.workflow_stage === 'PROPOSAL' && targetStage === 'APPROVAL' && !hasProposalEvidence) || (targetStage === 'REVIEW' && (!hasCompletionPhotoForSubmit || Boolean(order.procurement && !['NOT_REQUIRED', 'APPROVED'].includes(order.procurement.status))))}>{submitting ? copy.saving : action === 'reject' ? (locale === 'id' ? 'Kembalikan ke Dikerjakan' : 'Return to In Progress') : action === 'reopen' ? copy.reopenWork : isMidProgressUpdate ? copy.saveProgress : targetStage === 'REVIEW' ? (locale === 'id' ? 'Ajukan penyelesaian' : 'Submit for completion') : targetStage === 'COMPLETED' ? copy.approveCompletion : copy.confirmProgress}</button></footer>
    {showProgressDriveBrowser && <DriveBrowser title="Choose progress evidence" onClose={() => setShowProgressDriveBrowser(false)} onSelect={(selected, accessToken) => void transferProgressDrive(selected, accessToken)} />}
  </form>;
}

export function VendorActionForm({ order, onClose, onChanged }: Omit<WorkflowFormProps, 'currentUser'>) {
  const [mode, setMode] = useState<'search' | 'proposal' | 'submit'>(order.workflow_stage === 'PLANNED' ? 'search' : order.workflow_stage === 'FINDING_VENDOR' ? 'proposal' : 'submit');
  const [vendorSearchNote, setVendorSearchNote] = useState('');
  const [potentialVendorName, setPotentialVendorName] = useState('');
  const [contactedVendorName, setContactedVendorName] = useState('');
  const [shortlistNote, setShortlistNote] = useState('');
  const [vendorContactDetails, setVendorContactDetails] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [quotedCost, setQuotedCost] = useState('');
  const [proposalFile, setProposalFile] = useState<DriveBrowserItem | null>(null);
  const [localProposalFile, setLocalProposalFile] = useState<File | null>(null);
  const [proposalDriveToken, setProposalDriveToken] = useState('');
  const [showProposalDriveBrowser, setShowProposalDriveBrowser] = useState(false);
  const [proposalValidityDate, setProposalValidityDate] = useState('');
  const [expectedWorkDuration, setExpectedWorkDuration] = useState('');
  const [proposalNotes, setProposalNotes] = useState('');
  const [submissionNote, setSubmissionNote] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const hasProposalEvidence = order.attachments?.some((attachment) => attachment.evidence_type === 'PROPOSAL') ?? false;
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setSubmitting(true);
    try {
      if (mode === 'search') {
        await api(`/work-orders/${order.id}/vendor-search`, { method: 'POST', body: JSON.stringify({ vendorSearchNote, potentialVendorName: potentialVendorName || undefined, contactedVendorName: contactedVendorName || undefined, shortlistNote: shortlistNote || undefined, vendorContactDetails: vendorContactDetails || undefined, expectedVersion: order.version }) });
      } else if (mode === 'proposal') {
        let expectedVersion = order.version;
        let attachmentIds: string[] = [];
        if (localProposalFile) {
          const upload = new FormData(); upload.append('evidenceType', 'PROPOSAL'); upload.append('attachmentContext', 'VENDOR_PROPOSAL'); upload.append('expectedVersion', String(expectedVersion)); upload.append('file', localProposalFile);
          const uploaded = await uploadWithProgress<{ id: string; version: number }>(`/work-orders/${order.id}/attachments/upload`, upload, () => undefined);
          expectedVersion = uploaded.version; attachmentIds = [uploaded.id];
        }
        await api(`/work-orders/${order.id}/proposal`, { method: 'POST', headers: proposalFile ? { 'X-Google-Drive-Token': proposalDriveToken } : undefined, body: JSON.stringify({ vendorName, quotedCost: parseIdrInput(quotedCost), proposalValidityDate: proposalValidityDate || undefined, expectedWorkDuration: expectedWorkDuration || undefined, proposalNotes: proposalNotes || undefined, attachmentIds, sourceDriveFileId: proposalFile?.id, expectedVersion }) });
      } else if (mode === 'submit') {
        await api(`/work-orders/${order.id}/proposal/submit`, { method: 'POST', body: JSON.stringify({ note: submissionNote, expectedVersion: order.version }) });
      }
      await onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Vendor action failed.'); } finally { setSubmitting(false); }
  };
  return <form className="action-panel" onSubmit={submit}>
    <header><div><span>Preparing · 30%</span><h3>{mode === 'search' ? 'Update vendor preparation' : mode === 'proposal' ? 'Record vendor proposal' : 'Send proposal for approval'}</h3><p className="action-intro">Keep the update brief. Add commercial details only when a proposal is available.</p></div><button type="button" className="icon-button" onClick={onClose}><X /></button></header>
    {order.workflow_stage === 'FINDING_VENDOR' && <div className="segmented-control"><button type="button" className={mode === 'search' ? 'active' : ''} onClick={() => setMode('search')}>Still preparing</button><button type="button" className={mode === 'proposal' ? 'active' : ''} onClick={() => setMode('proposal')}>Proposal received</button></div>}
    {order.workflow_stage === 'PROPOSAL' && <div className="segmented-control"><button type="button" className={mode === 'proposal' ? 'active' : ''} onClick={() => setMode('proposal')}>Update proposal</button><button type="button" className={mode === 'submit' ? 'active' : ''} onClick={() => setMode('submit')}>Ready for approval</button></div>}
    {mode === 'search' && <div className="form-grid compact">
      <Field label="Short update" required hint="Example: Contacted two vendors; waiting for site visit confirmation."><textarea rows={4} value={vendorSearchNote} onChange={(event) => { setVendorSearchNote(event.target.value); setShortlistNote(event.target.value); }} required /></Field>
      <Field label="Vendor name, if known"><input value={potentialVendorName} onChange={(event) => setPotentialVendorName(event.target.value)} /></Field>
    </div>}
    {mode === 'proposal' && <div className="form-grid compact">
      <Field label="Vendor name" required><input value={vendorName} onChange={(event) => setVendorName(event.target.value)} required /></Field>
      <Field label="Quoted cost" required hint={parseIdrInput(quotedCost) ? formatIdrCurrency(parseIdrInput(quotedCost)) : 'Enter the total proposal value in IDR.'}><div className="currency-input"><span>Rp</span><input inputMode="numeric" value={quotedCost} onChange={(event) => setQuotedCost(formatIdrInput(event.target.value))} placeholder="0" required /></div></Field>
      <div className="proposal-attachment"><span>Vendor proposal document <b>*</b></span><label className="file-picker"><FileUp /><span>{localProposalFile?.name ?? 'Upload from device'}</span><input type="file" accept={evidenceRules.allowedExtensions.map((extension) => `.${extension}`).join(',')} onChange={(event) => { setLocalProposalFile(event.target.files?.[0] ?? null); setProposalFile(null); }} /></label>{proposalFile ? <button type="button" className="selected-drive-file" onClick={() => setShowProposalDriveBrowser(true)}><FolderSearch /><span><strong>{proposalFile.name}</strong><small>Will create a private shortcut in 03 Proposals when saved</small></span></button> : <button type="button" className="drive-browse-button" onClick={() => setShowProposalDriveBrowser(true)}><FolderSearch /> Choose from Google Drive <small>Share with the Woko Drive worker and create a shortcut</small></button>}{hasProposalEvidence && !proposalFile && !localProposalFile && <small className="existing-evidence-note"><Check /> An existing proposal document is already attached.</small>}</div>
      <details className="optional-fields"><summary>Add optional proposal details</summary><div className="form-grid compact"><Field label="Proposal validity date"><input type="date" value={proposalValidityDate} onChange={(event) => setProposalValidityDate(event.target.value)} /></Field><Field label="Expected work duration"><input value={expectedWorkDuration} onChange={(event) => setExpectedWorkDuration(event.target.value)} placeholder="Example: 5 working days" /></Field><Field label="Proposal notes"><textarea rows={3} value={proposalNotes} onChange={(event) => setProposalNotes(event.target.value)} /></Field></div></details>
    </div>}
    {mode === 'submit' && <div className="form-grid compact"><Field label="Submission note" required><textarea rows={4} value={submissionNote} onChange={(event) => setSubmissionNote(event.target.value)} required /></Field>{!hasProposalEvidence && <p className="form-error">A proposal document is required before submission.</p>}</div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <footer><button className="primary-button" disabled={submitting || (mode === 'proposal' && !hasProposalEvidence && !proposalFile && !localProposalFile) || (mode === 'submit' && !hasProposalEvidence)}>{submitting ? 'Saving...' : mode === 'search' ? 'Save vendor search' : mode === 'proposal' ? 'Record proposal' : 'Submit for approval'}</button></footer>
    {showProposalDriveBrowser && <DriveBrowser title="Choose vendor proposal" onClose={() => setShowProposalDriveBrowser(false)} onSelect={(selected, accessToken) => { if (window.confirm(`Use “${selected.name}” as the vendor proposal?\n\nWhen you save, Woko will share edit access with everyone on this work card and create a shortcut in the private project folder. The original file stays in place.`)) { setProposalFile(selected); setProposalDriveToken(accessToken); } setShowProposalDriveBrowser(false); }} />}
  </form>;
}

export function ProposalDecisionForm({ order, locale, onClose, onChanged }: Omit<WorkflowFormProps, 'currentUser'> & { locale: Locale }) {
  const copy = locale === 'id'
    ? { overview: 'Tinjauan manajemen', title: 'Tinjau proposal vendor', intro: 'Setujui, tolak, atau minta revisi proposal vendor.', approved: 'Setujui', rejected: 'Tolak', revision: 'Minta revisi', plannedStartDate: 'Tanggal mulai rencana', decisionNote: 'Catatan keputusan', saving: 'Menyimpan...', record: 'Catat keputusan', failed: 'Keputusan proposal tidak dapat dicatat.' }
    : { overview: 'Director overview', title: 'Review vendor proposal', intro: 'Approve, reject, or request a revision to the vendor proposal.', approved: 'Approve', rejected: 'Reject', revision: 'Request revision', plannedStartDate: 'Planned start date', decisionNote: 'Decision note', saving: 'Saving...', record: 'Record decision', failed: 'Proposal decision failed.' };
  const decisionLabels: Record<ProposalDecision, string> = { APPROVED: copy.approved, REJECTED: copy.rejected, REVISION_REQUIRED: copy.revision };
  const [decision, setDecision] = useState<ProposalDecision>('APPROVED');
  const [decisionNote, setDecisionNote] = useState('');
  const [plannedStartDate, setPlannedStartDate] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setSubmitting(true);
    try {
      await api(`/work-orders/${order.id}/proposal/decision`, { method: 'POST', body: JSON.stringify({ decision, decisionNote, plannedStartDate: decision === 'APPROVED' ? plannedStartDate : undefined, expectedVersion: order.version }) });
      await onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : copy.failed); } finally { setSubmitting(false); }
  };
  return <form className="action-panel" onSubmit={submit}>
    <header><div><span>{copy.overview}</span><h3>{copy.title}</h3><p className="action-intro">{copy.intro}</p></div><button type="button" className="icon-button" onClick={onClose}><X /></button></header>
    <div className="segmented-control">{proposalDecisions.map((value) => <button type="button" key={value} className={decision === value ? 'active' : ''} onClick={() => setDecision(value)}>{decisionLabels[value]}</button>)}</div>
    <div className="form-grid compact">
      {decision === 'APPROVED' && <Field label={copy.plannedStartDate} required><input type="date" value={plannedStartDate} onChange={(event) => setPlannedStartDate(event.target.value)} required /></Field>}
      <Field label={copy.decisionNote} required><textarea rows={4} value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} required /></Field>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <footer><button className="primary-button" disabled={submitting}>{submitting ? copy.saving : copy.record}</button></footer>
  </form>;
}
