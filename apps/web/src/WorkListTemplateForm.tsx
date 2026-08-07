import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, MapPin, Plus, Save, Trash2, Users, X } from 'lucide-react';
import { api } from './api';
import type { LocationOption, ReferenceData, WorkListTemplate } from './types';

const createBlankTemplate = (): WorkListTemplate => ({
  id: '',
  title: '',
  instructions: '',
  active: true,
  version: 1,
  location_ids: [],
  worker_ids: [],
  items: [{ title: '', instructions: '', recurrence: 'DAILY', required: true }],
});

function locationPath(location: LocationOption, references: ReferenceData) {
  const optionsById = new Map(references.locationOptions.map((option) => [option.id, option]));
  const building = references.buildings.find((item) => item.id === location.building_id);
  const campus = references.campuses.find((item) => item.id === building?.campus_id);
  const ancestors: LocationOption[] = [];
  let parent = location.parent_id ? optionsById.get(location.parent_id) : undefined;
  const visited = new Set<string>();

  while (parent && !visited.has(parent.id)) {
    visited.add(parent.id);
    ancestors.unshift(parent);
    parent = parent.parent_id ? optionsById.get(parent.parent_id) : undefined;
  }

  return {
    campus: campus?.name ?? '',
    building: building?.name ?? 'Unassigned unit',
    path: [...ancestors, location].map((item) => item.name).join(' › '),
    type: location.type_label.replaceAll('_', ' '),
  };
}

export function WorkListTemplateForm({ references, onClose }: { references: ReferenceData; onClose: () => void }) {
  const [templates, setTemplates] = useState<WorkListTemplate[]>([]);
  const [draft, setDraft] = useState<WorkListTemplate>(createBlankTemplate);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [locationBuildingId, setLocationBuildingId] = useState(references.buildings[0]?.id ?? '');
  const [locationBranchId, setLocationBranchId] = useState('');
  const workers = references.users.filter((user) => user.roles.includes('WORKER'));

  const locations = useMemo(() => references.locationOptions.map((location) => ({
    ...location,
    display: locationPath(location, references),
  })).sort((left, right) => `${left.display.building} ${left.display.path}`.localeCompare(`${right.display.building} ${right.display.path}`)), [references]);
  const locationById = useMemo(() => new Map(locations.map((location) => [location.id, location])), [locations]);
  const rootLocations = locations.filter((location) => location.building_id === locationBuildingId && !location.parent_id);
  const selectedBranch = locationBranchId ? locationById.get(locationBranchId) : undefined;
  const availableLocations = useMemo(() => {
    if (!selectedBranch) return [];
    const descendants: typeof locations = [];
    const appendLeaves = (parentId: string) => {
      const children = locations.filter((location) => location.parent_id === parentId);
      if (!children.length) {
        const location = locationById.get(parentId);
        if (location) descendants.push(location);
        return;
      }
      for (const child of children) appendLeaves(child.id);
    };
    appendLeaves(selectedBranch.id);
    return descendants;
  }, [locationById, locations, selectedBranch]);
  const selectedLocations = draft.location_ids.map((id) => locationById.get(id)).filter((location): location is NonNullable<typeof location> => Boolean(location));

  const load = async () => {
    try {
      setError('');
      setTemplates(await api<WorkListTemplate[]>('/work-lists/templates'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load templates.');
    }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (rootLocations.some((location) => location.id === locationBranchId)) return;
    setLocationBranchId(rootLocations[0]?.id ?? '');
  }, [locationBranchId, rootLocations]);

  const toggle = (key: 'location_ids' | 'worker_ids', value: string) => {
    setDraft((current) => ({
      ...current,
      [key]: current[key].includes(value) ? current[key].filter((id) => id !== value) : [...current[key], value],
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      setError('');
      const body = {
        title: draft.title,
        instructions: draft.instructions,
        active: draft.active,
        locationIds: draft.location_ids,
        workerIds: draft.worker_ids,
        items: draft.items.map(({ id: _id, sort_order: _sort, ...item }) => item),
      };
      if (draft.id) await api(`/work-lists/templates/${draft.id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/work-lists/templates', { method: 'POST', body: JSON.stringify(body) });
      setDraft(createBlankTemplate());
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save template.');
    } finally {
      setSaving(false);
    }
  };

  const updateItem = (index: number, value: Partial<WorkListTemplate['items'][number]>) => {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...value } : item),
    }));
  };

  const removeItem = (index: number) => {
    setDraft((current) => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) }));
  };

  const invalid = !draft.title.trim() || !draft.location_ids.length || !draft.worker_ids.length || !draft.items.length || draft.items.some((item) => !item.title.trim());

  return <div className="sheet-backdrop" onMouseDown={onClose}>
    <section className="sheet work-list-template-sheet" onMouseDown={(event) => event.stopPropagation()}>
      <header className="sheet-header">
        <div><span>Organization Settings</span><h2>Work List Templates</h2></div>
        <button className="icon-button" onClick={onClose} aria-label="Back to organization settings"><X /></button>
      </header>

      <div className="sheet-content work-list-template-content">
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="template-layout">
          <aside className="template-sidebar">
            <div className="template-sidebar-heading">
              <div><span>Saved templates</span><strong>{templates.length}</strong></div>
              <button className="secondary-button template-new-button" onClick={() => setDraft(createBlankTemplate())}><Plus /> New</button>
            </div>
            <div className="template-list">
              {templates.map((template) => <button className={draft.id === template.id ? 'active' : ''} key={template.id} onClick={() => setDraft(template)}>
                <span className="template-list-icon"><ClipboardList /></span>
                <span><strong>{template.title}</strong><small>{template.active ? 'Active' : 'Inactive'} · {template.items.length} tasks</small></span>
              </button>)}
              {!templates.length && <p>No templates have been created yet.</p>}
            </div>
          </aside>

          <div className="template-editor">
            <section className="template-editor-section">
              <header><div><h3>{draft.id ? 'Edit template' : 'Create a template'}</h3><p>Define the recurring checklist and who completes it.</p></div><label className="template-active-toggle"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /> Active</label></header>
              <div className="template-basics">
                <label className="form-field"><span>Template name *</span><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="e.g. Daily classroom readiness" /></label>
                <label className="form-field"><span>Instructions</span><textarea rows={3} value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} placeholder="Shared guidance for every generated Work List." /></label>
              </div>
            </section>

            <div className="template-assignment-grid">
              <section className="template-editor-section template-assignment-section template-location-section">
                <header><MapPin /><div><h3>Assigned locations *</h3><p>Choose a unit and floor, then assign only the rooms or locations shown.</p></div></header>
                {locations.length ? <>
                  <div className="location-cascade-controls">
                    <label className="form-field"><span>Unit / building</span><select value={locationBuildingId} onChange={(event) => { setLocationBuildingId(event.target.value); setLocationBranchId(''); }}>{references.buildings.map((building) => <option key={building.id} value={building.id}>{references.campuses.find((campus) => campus.id === building.campus_id)?.name} · {building.name}</option>)}</select></label>
                    <label className="form-field"><span>Floor / area</span><select value={locationBranchId} onChange={(event) => setLocationBranchId(event.target.value)} disabled={!rootLocations.length}>{rootLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
                  </div>
                  <div className="location-cascade-heading"><strong>{selectedBranch ? `Locations in ${selectedBranch.name}` : 'Available locations'}</strong><span>{availableLocations.length} available</span></div>
                  <div className="template-picker-list location-cascade-list">
                    {availableLocations.map((location) => <label key={location.id}>
                      <input type="checkbox" checked={draft.location_ids.includes(location.id)} onChange={() => toggle('location_ids', location.id)} />
                      <span><strong>{location.display.path.split(' › ').slice(1).join(' › ') || location.name}</strong><small>{location.display.type}</small></span>
                    </label>)}
                    {!rootLocations.length && <p>No floors or areas are configured for this unit.</p>}
                    {Boolean(rootLocations.length) && !availableLocations.length && <p>No assignable rooms or locations are configured under this floor.</p>}
                  </div>
                  <div className="selected-location-summary">
                    <div><strong>Selected locations</strong><span>{selectedLocations.length}</span></div>
                    {selectedLocations.length ? <div className="selected-location-list">{selectedLocations.map((location) => <span key={location.id}><span><strong>{location.display.building} › {location.display.path}</strong><small>{location.display.campus}</small></span><button type="button" onClick={() => toggle('location_ids', location.id)} aria-label={`Remove ${location.name}`}><X /></button></span>)}</div> : <p>No locations selected yet.</p>}
                  </div>
                </> : <div className="template-picker-list"><p>No locations are configured. Add them in Organization Settings → Locations.</p></div>}
              </section>

              <section className="template-editor-section template-assignment-section">
                <header><Users /><div><h3>Assigned workers *</h3><p>Choose the workers responsible for this checklist.</p></div></header>
                <div className="template-picker-list">
                  {workers.map((worker) => <label key={worker.id}>
                    <input type="checkbox" checked={draft.worker_ids.includes(worker.id)} onChange={() => toggle('worker_ids', worker.id)} />
                    <span><strong>{worker.full_name}</strong><small>{worker.email}</small></span>
                  </label>)}
                  {!workers.length && <p>No active workers are available.</p>}
                </div>
              </section>
            </div>

            <section className="template-editor-section template-tasks-section">
              <header><div><h3>Checklist tasks</h3><p>Each task creates a recurring item due at 17:00.</p></div><button className="secondary-button" onClick={() => setDraft({ ...draft, items: [...draft.items, { title: '', instructions: '', recurrence: 'DAILY', required: true }] })}><Plus /> Add task</button></header>
              <div className="template-task-list">
                {draft.items.map((item, index) => <article className="template-item" key={item.id ?? index}>
                  <div className="template-item-number">{index + 1}</div>
                  <div className="template-item-fields">
                    <label className="form-field"><span>Task title *</span><input placeholder="What needs to be checked?" value={item.title} onChange={(event) => updateItem(index, { title: event.target.value })} /></label>
                    <label className="form-field"><span>Schedule</span><select value={item.recurrence} onChange={(event) => updateItem(index, { recurrence: event.target.value as typeof item.recurrence })}><option value="DAILY">Daily · due 17:00</option><option value="WEEKLY">Weekly · Saturday 17:00</option><option value="MONTHLY">Monthly · last Saturday 17:00</option></select></label>
                    <label className="form-field template-item-instructions"><span>Completion instructions</span><textarea rows={2} placeholder="Optional details for the worker" value={item.instructions} onChange={(event) => updateItem(index, { instructions: event.target.value })} /></label>
                    <label className="template-required"><input type="checkbox" checked={item.required} onChange={(event) => updateItem(index, { required: event.target.checked })} /> Required for submission</label>
                  </div>
                  <button className="icon-button template-remove-task" disabled={draft.items.length === 1} onClick={() => removeItem(index)} aria-label={`Remove task ${index + 1}`}><Trash2 /></button>
                </article>)}
              </div>
            </section>
          </div>
        </div>
      </div>

      <footer className="sheet-actions template-actions">
        <span>{draft.id ? `Editing version ${draft.version}` : 'New template'}</span>
        <div><button className="secondary-button" onClick={onClose}>Back</button><button className="primary-button" disabled={invalid || saving} onClick={() => void save()}><Save /> {saving ? 'Saving…' : 'Save template'}</button></div>
      </footer>
    </section>
  </div>;
}
