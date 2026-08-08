import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, MapPin, Plus, Save, Trash2, Users, X } from 'lucide-react';
import { api } from './api';
import { displayLocationType, type Locale } from './i18n';
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


function locationPath(location: LocationOption, references: ReferenceData, locale: Locale) {
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
    building: building?.name ?? (locale === 'id' ? 'Unit belum ditetapkan' : 'Unassigned unit'),
    path: [...ancestors, location].map((item) => item.name).join(' › '),
    type: displayLocationType(location.type_label, locale),
  };
}

export function WorkListTemplateForm({ references, locale, onClose }: { references: ReferenceData; locale: Locale; onClose: () => void }) {
  const id = locale === 'id';
  const [templates, setTemplates] = useState<WorkListTemplate[]>([]);
  const [draft, setDraft] = useState<WorkListTemplate>(createBlankTemplate);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [locationBuildingId, setLocationBuildingId] = useState(references.buildings[0]?.id ?? '');
  const [locationBranchId, setLocationBranchId] = useState('');
  const workers = references.users.filter((user) => user.roles.includes('WORKER'));

  const locations = useMemo(() => references.locationOptions.map((location) => ({
    ...location,
    display: locationPath(location, references, locale),
  })).sort((left, right) => `${left.display.building} ${left.display.path}`.localeCompare(`${right.display.building} ${right.display.path}`, id ? 'id-ID' : 'en-US')), [id, locale, references]);
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
      setError(caught instanceof Error ? caught.message : id ? 'Templat tidak dapat dimuat.' : 'Could not load templates.');
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
      setError(caught instanceof Error ? caught.message : id ? 'Templat tidak dapat disimpan.' : 'Could not save template.');
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
        <div><span>{id ? 'Pengaturan Organisasi' : 'Organization Settings'}</span><h2>{id ? 'Templat Pekerjaan Rutin' : 'Routine Work Templates'}</h2></div>
        <button className="icon-button" onClick={onClose} aria-label={id ? 'Kembali ke pengaturan organisasi' : 'Back to organization settings'}><X /></button>
      </header>

      <div className="sheet-content work-list-template-content">
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="template-layout">
          <aside className="template-sidebar">
            <div className="template-sidebar-heading">
              <div><span>{id ? 'Templat tersimpan' : 'Saved templates'}</span><strong>{templates.length}</strong></div>
              <button className="secondary-button template-new-button" onClick={() => setDraft(createBlankTemplate())}><Plus /> {id ? 'Baru' : 'New'}</button>
            </div>
            <div className="template-list">
              {templates.map((template) => <button className={draft.id === template.id ? 'active' : ''} key={template.id} onClick={() => setDraft(template)}>
                <span className="template-list-icon"><ClipboardList /></span>
                <span><strong>{template.title}</strong><small>{template.active ? id ? 'Aktif' : 'Active' : id ? 'Nonaktif' : 'Inactive'} · {template.items.length} {id ? 'tugas' : 'tasks'}</small></span>
              </button>)}
              {!templates.length && <p>{id ? 'Belum ada templat yang dibuat.' : 'No templates have been created yet.'}</p>}
            </div>
          </aside>

          <div className="template-editor">
            <section className="template-editor-section">
              <header><div><h3>{draft.id ? id ? 'Ubah templat' : 'Edit template' : id ? 'Buat templat' : 'Create a template'}</h3><p>{id ? 'Tentukan daftar periksa berulang dan siapa yang mengerjakannya.' : 'Define the recurring checklist and who completes it.'}</p></div><label className="template-active-toggle"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /> {id ? 'Aktif' : 'Active'}</label></header>
              <div className="template-basics">
                <label className="form-field"><span>{id ? 'Nama templat *' : 'Template name *'}</span><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder={id ? 'mis. Kesiapan ruang kelas harian' : 'e.g. Daily classroom readiness'} /></label>
                <label className="form-field"><span>{id ? 'Petunjuk' : 'Instructions'}</span><textarea rows={3} value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} placeholder={id ? 'Panduan bersama untuk setiap pekerjaan rutin yang dibuat.' : 'Shared guidance for all generated Routine Work.'} /></label>
              </div>
            </section>

            <div className="template-assignment-grid">
              <section className="template-editor-section template-assignment-section template-location-section">
                <header><MapPin /><div><h3>{id ? 'Lokasi yang ditetapkan *' : 'Assigned locations *'}</h3><p>{id ? 'Pilih unit dan lantai, lalu tetapkan hanya ruangan atau lokasi yang ditampilkan.' : 'Choose a unit and floor, then assign only the rooms or locations shown.'}</p></div></header>
                {locations.length ? <>
                  <div className="location-cascade-controls">
                    <label className="form-field"><span>{id ? 'Unit / gedung' : 'Unit / building'}</span><select value={locationBuildingId} onChange={(event) => { setLocationBuildingId(event.target.value); setLocationBranchId(''); }}>{references.buildings.map((building) => <option key={building.id} value={building.id}>{references.campuses.find((campus) => campus.id === building.campus_id)?.name} · {building.name}</option>)}</select></label>
                    <label className="form-field"><span>{id ? 'Lantai / area' : 'Floor / area'}</span><select value={locationBranchId} onChange={(event) => setLocationBranchId(event.target.value)} disabled={!rootLocations.length}>{rootLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
                  </div>
                  <div className="location-cascade-heading"><strong>{selectedBranch ? id ? `Lokasi di ${selectedBranch.name}` : `Locations in ${selectedBranch.name}` : id ? 'Lokasi tersedia' : 'Available locations'}</strong><span>{availableLocations.length} {id ? 'tersedia' : 'available'}</span></div>
                  <div className="template-picker-list location-cascade-list">
                    {availableLocations.map((location) => <label key={location.id}>
                      <input type="checkbox" checked={draft.location_ids.includes(location.id)} onChange={() => toggle('location_ids', location.id)} />
                      <span><strong>{location.display.path.split(' › ').slice(1).join(' › ') || location.name}</strong><small>{location.display.type}</small></span>
                    </label>)}
                    {!rootLocations.length && <p>{id ? 'Belum ada lantai atau area yang dikonfigurasi untuk unit ini.' : 'No floors or areas are configured for this unit.'}</p>}
                    {Boolean(rootLocations.length) && !availableLocations.length && <p>{id ? 'Belum ada ruangan atau lokasi yang dapat ditetapkan di bawah lantai ini.' : 'No assignable rooms or locations are configured under this floor.'}</p>}
                  </div>
                  <div className="selected-location-summary">
                    <div><strong>{id ? 'Lokasi terpilih' : 'Selected locations'}</strong><span>{selectedLocations.length}</span></div>
                    {selectedLocations.length ? <div className="selected-location-list">{selectedLocations.map((location) => <span key={location.id}><span><strong>{location.display.building} › {location.display.path}</strong><small>{location.display.campus}</small></span><button type="button" onClick={() => toggle('location_ids', location.id)} aria-label={id ? `Hapus ${location.name}` : `Remove ${location.name}`}><X /></button></span>)}</div> : <p>{id ? 'Belum ada lokasi yang dipilih.' : 'No locations selected yet.'}</p>}
                  </div>
                </> : <div className="template-picker-list"><p>{id ? 'Belum ada lokasi yang dikonfigurasi. Tambahkan melalui Pengaturan Organisasi → Lokasi.' : 'No locations are configured. Add them in Organization Settings → Locations.'}</p></div>}
              </section>

              <section className="template-editor-section template-assignment-section">
                <header><Users /><div><h3>{id ? 'Pekerja yang ditetapkan *' : 'Assigned workers *'}</h3><p>{id ? 'Pilih pekerja yang bertanggung jawab atas daftar periksa ini.' : 'Choose the workers responsible for this checklist.'}</p></div></header>
                <div className="template-picker-list">
                  {workers.map((worker) => <label key={worker.id}>
                    <input type="checkbox" checked={draft.worker_ids.includes(worker.id)} onChange={() => toggle('worker_ids', worker.id)} />
                    <span><strong>{worker.full_name}</strong><small>{worker.email}</small></span>
                  </label>)}
                  {!workers.length && <p>{id ? 'Tidak ada pekerja aktif yang tersedia.' : 'No active workers are available.'}</p>}
                </div>
              </section>
            </div>

            <section className="template-editor-section template-tasks-section">
              <header><div><h3>{id ? 'Tugas daftar periksa' : 'Checklist tasks'}</h3><p>{id ? 'Setiap tugas membuat item berulang dengan tenggat pukul 17.00.' : 'Each task creates a recurring item due at 17:00.'}</p></div><button className="secondary-button" onClick={() => setDraft({ ...draft, items: [...draft.items, { title: '', instructions: '', recurrence: 'DAILY', required: true }] })}><Plus /> {id ? 'Tambah tugas' : 'Add task'}</button></header>
              <div className="template-task-list">
                {draft.items.map((item, index) => <article className="template-item" key={item.id ?? index}>
                  <div className="template-item-number">{index + 1}</div>
                  <div className="template-item-fields">
                    <label className="form-field"><span>{id ? 'Judul tugas *' : 'Task title *'}</span><input placeholder={id ? 'Apa yang perlu diperiksa?' : 'What needs to be checked?'} value={item.title} onChange={(event) => updateItem(index, { title: event.target.value })} /></label>
                    <label className="form-field"><span>{id ? 'Jadwal' : 'Schedule'}</span><select value={item.recurrence} onChange={(event) => updateItem(index, { recurrence: event.target.value as typeof item.recurrence })}><option value="DAILY">{id ? 'Harian · tenggat 17.00' : 'Daily · due 17:00'}</option><option value="WEEKLY">{id ? 'Mingguan · Sabtu 17.00' : 'Weekly · Saturday 17:00'}</option><option value="MONTHLY">{id ? 'Bulanan · Sabtu terakhir 17.00' : 'Monthly · last Saturday 17:00'}</option></select></label>
                    <label className="form-field template-item-instructions"><span>{id ? 'Petunjuk penyelesaian' : 'Completion instructions'}</span><textarea rows={2} placeholder={id ? 'Detail opsional untuk pekerja' : 'Optional details for the worker'} value={item.instructions} onChange={(event) => updateItem(index, { instructions: event.target.value })} /></label>
                    <label className="template-required"><input type="checkbox" checked={item.required} onChange={(event) => updateItem(index, { required: event.target.checked })} /> {id ? 'Wajib untuk dikirim' : 'Required for submission'}</label>
                  </div>
                  <button className="icon-button template-remove-task" disabled={draft.items.length === 1} onClick={() => removeItem(index)} aria-label={id ? `Hapus tugas ${index + 1}` : `Remove task ${index + 1}`}><Trash2 /></button>
                </article>)}
              </div>
            </section>
          </div>
        </div>
      </div>

      <footer className="sheet-actions template-actions">
        <span>{draft.id ? id ? `Mengubah versi ${draft.version}` : `Editing version ${draft.version}` : id ? 'Templat baru' : 'New template'}</span>
        <div><button className="secondary-button" onClick={onClose}>{id ? 'Kembali' : 'Back'}</button><button className="primary-button" disabled={invalid || saving} onClick={() => void save()}><Save /> {saving ? id ? 'Menyimpan…' : 'Saving…' : id ? 'Simpan templat' : 'Save template'}</button></div>
      </footer>
    </section>
  </div>;
}
