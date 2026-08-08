import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Building2, ChevronDown, ChevronRight, MapPin, Plus, Save, Trash2, X } from 'lucide-react';
import { api } from './api';
import { displayLocationType, type Locale } from './i18n';
import type { AdminLocationData } from './types';

const emptyData: AdminLocationData = { campuses: [], buildings: [], options: [] };
const createId = () => crypto.randomUUID();
const snapshot = (value: AdminLocationData) => JSON.stringify(value);

type AdminLocationOption = AdminLocationData['options'][number];


function orderLocationTree(options: AdminLocationOption[]): AdminLocationOption[] {
  const byParent = new Map<string | null, AdminLocationOption[]>();
  for (const option of options) {
    const siblings = byParent.get(option.parent_id) ?? [];
    siblings.push(option);
    byParent.set(option.parent_id, siblings);
  }
  for (const siblings of byParent.values()) siblings.sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name));
  const ordered: AdminLocationOption[] = [];
  const visited = new Set<string>();
  const appendChildren = (parentId: string | null) => {
    for (const option of byParent.get(parentId) ?? []) {
      if (visited.has(option.id)) continue;
      visited.add(option.id);
      ordered.push(option);
      appendChildren(option.id);
    }
  };
  appendChildren(null);
  for (const option of options) if (!visited.has(option.id)) ordered.push(option);
  return ordered;
}

export function AdminLocations({ locale, onClose, onChanged }: { locale: Locale; onClose: () => void; onChanged: () => Promise<void> | void }) {
  const id = locale === 'id';
  const [data, setData] = useState<AdminLocationData>(emptyData);
  const [savedSnapshot, setSavedSnapshot] = useState(snapshot(emptyData));
  const [removedBuildingIds, setRemovedBuildingIds] = useState<string[]>([]);
  const [removedOptionIds, setRemovedOptionIds] = useState<string[]>([]);
  const [campusDraft, setCampusDraft] = useState({ code: '', name: '' });
  const [buildingDraft, setBuildingDraft] = useState({ campusId: '', code: '', name: '' });
  const [optionDraft, setOptionDraft] = useState({ buildingId: '', parentId: '', typeLabel: 'AREA', code: '', name: '', sortOrder: '0' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [collapsedOptionIds, setCollapsedOptionIds] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  const dirty = loaded && (snapshot(data) !== savedSnapshot || removedBuildingIds.length > 0 || removedOptionIds.length > 0);

  const load = async () => {
    try {
      setError('');
      const loadedData = await api<AdminLocationData>('/admin/locations');
      setData(loadedData);
      setSavedSnapshot(snapshot(loadedData));
      setRemovedBuildingIds([]);
      setRemovedOptionIds([]);
      setBuildingDraft((current) => ({ ...current, campusId: loadedData.campuses[0]?.id || '' }));
      setOptionDraft((current) => ({ ...current, buildingId: loadedData.buildings[0]?.id || '', parentId: '' }));
      setLoaded(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : id ? 'Lokasi tidak dapat dimuat.' : 'Locations could not be loaded.'); }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const requestClose = () => {
    if (dirty && !window.confirm(id ? 'Anda memiliki perubahan lokasi yang belum disimpan. Buang perubahan dan tutup?' : 'You have unsaved location changes. Discard them and close?')) return;
    onClose();
  };

  const addCampus = (event: FormEvent) => {
    event.preventDefault();
    setData((current) => ({ ...current, campuses: [...current.campuses, { id: createId(), code: campusDraft.code.trim().toUpperCase(), name: campusDraft.name.trim(), active: true }] }));
    setCampusDraft({ code: '', name: '' });
  };

  const addBuilding = (event: FormEvent) => {
    event.preventDefault();
    const id = createId();
    setData((current) => ({ ...current, buildings: [...current.buildings, { id, campus_id: buildingDraft.campusId, code: buildingDraft.code.trim().toUpperCase(), name: buildingDraft.name.trim(), active: true }] }));
    setBuildingDraft((current) => ({ ...current, code: '', name: '' }));
    setOptionDraft((current) => ({ ...current, buildingId: current.buildingId || id }));
  };

  const addOption = (event: FormEvent) => {
    event.preventDefault();
    setData((current) => ({ ...current, options: [...current.options, {
      id: createId(), building_id: optionDraft.buildingId, parent_id: optionDraft.parentId || null,
      type_label: optionDraft.typeLabel.trim().toUpperCase().replaceAll(/[^A-Z0-9]+/g, '_'), code: optionDraft.code.trim().toUpperCase() || null,
      name: optionDraft.name.trim(), active: true, sort_order: Number(optionDraft.sortOrder),
    }] }));
    setOptionDraft((current) => ({ ...current, code: '', name: '', sortOrder: '0' }));
  };

  const removeBuilding = (id: string) => {
    const optionIds = data.options.filter((option) => option.building_id === id).map((option) => option.id);
    setData((current) => ({ ...current, buildings: current.buildings.filter((building) => building.id !== id), options: current.options.filter((option) => option.building_id !== id) }));
    if (savedSnapshot.includes(id)) setRemovedBuildingIds((current) => [...new Set([...current, id])]);
    setRemovedOptionIds((current) => [...new Set([...current, ...optionIds.filter((optionId) => savedSnapshot.includes(optionId))])]);
    setOptionDraft((current) => ({ ...current, buildingId: current.buildingId === id ? data.buildings.find((building) => building.id !== id)?.id ?? '' : current.buildingId, parentId: '' }));
  };

  const removeOption = (id: string) => {
    const ids = new Set<string>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      data.options.forEach((option) => { if (option.parent_id && ids.has(option.parent_id) && !ids.has(option.id)) { ids.add(option.id); changed = true; } });
    }
    setData((current) => ({ ...current, options: current.options.filter((option) => !ids.has(option.id)) }));
    setRemovedOptionIds((current) => [...new Set([...current, ...[...ids].filter((optionId) => savedSnapshot.includes(optionId))])]);
    setOptionDraft((current) => ({ ...current, parentId: ids.has(current.parentId) ? '' : current.parentId }));
  };

  const saveAll = async () => {
    setSaving(true); setError('');
    try {
      await api('/admin/locations', { method: 'PUT', body: JSON.stringify({
        campuses: data.campuses,
        buildings: data.buildings.map((building) => ({ id: building.id, campusId: building.campus_id, code: building.code, name: building.name, active: building.active })),
        options: data.options.map((option) => ({ id: option.id, buildingId: option.building_id, parentId: option.parent_id, typeLabel: option.type_label, code: option.code, name: option.name, active: option.active, sortOrder: option.sort_order })),
        removedBuildingIds, removedOptionIds,
      }) });
      await load();
      await onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : id ? 'Konfigurasi lokasi tidak dapat disimpan.' : 'Location configuration could not be saved.'); }
    finally { setSaving(false); }
  };

  const orderedOptionsByBuilding = useMemo(() => new Map(data.buildings.map((building) => [building.id, orderLocationTree(data.options.filter((option) => option.building_id === building.id))])), [data.buildings, data.options]);
  const selectedBuildingOptions = orderedOptionsByBuilding.get(optionDraft.buildingId) ?? [];
  const selectedOptionById = new Map(selectedBuildingOptions.map((option) => [option.id, option]));
  const selectedParentPath: AdminLocationOption[] = [];
  let selectedParent = optionDraft.parentId ? selectedOptionById.get(optionDraft.parentId) : undefined;
  while (selectedParent) {
    selectedParentPath.unshift(selectedParent);
    selectedParent = selectedParent.parent_id ? selectedOptionById.get(selectedParent.parent_id) : undefined;
  }
  const parentCascadeLevels: Array<{ parentId: string | null; options: AdminLocationOption[]; selectedId: string }> = [];
  let cascadeParentId: string | null = null;
  for (let depth = 0; depth <= selectedParentPath.length; depth += 1) {
    const options = selectedBuildingOptions.filter((option) => option.parent_id === cascadeParentId);
    if (!options.length) break;
    const selectedId = selectedParentPath[depth]?.id ?? '';
    parentCascadeLevels.push({ parentId: cascadeParentId, options, selectedId });
    if (!selectedId) break;
    cascadeParentId = selectedId;
  }
  const selectParentLevel = (depth: number, selectedId: string) => {
    const previousParentId = depth > 0 ? selectedParentPath[depth - 1]?.id ?? '' : '';
    setOptionDraft((current) => ({ ...current, parentId: selectedId || previousParentId }));
  };
  const optionDepths = useMemo(() => {
    const depths = new Map<string, number>();
    const depthOf = (id: string, visiting = new Set<string>()): number => {
      if (depths.has(id)) return depths.get(id)!;
      if (visiting.has(id)) return 0;
      visiting.add(id);
      const option = data.options.find((item) => item.id === id);
      const depth = option?.parent_id ? depthOf(option.parent_id, visiting) + 1 : 0;
      depths.set(id, depth);
      return depth;
    };
    data.options.forEach((option) => depthOf(option.id));
    return depths;
  }, [data.options]);
  const optionHasChildren = (id: string) => data.options.some((option) => option.parent_id === id);
  const isOptionVisible = (option: AdminLocationOption) => {
    let parentId = option.parent_id;
    while (parentId) {
      if (collapsedOptionIds.has(parentId)) return false;
      parentId = data.options.find((candidate) => candidate.id === parentId)?.parent_id ?? null;
    }
    return true;
  };
  const toggleOption = (id: string) => setCollapsedOptionIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return <div className="sheet-backdrop" onMouseDown={requestClose}><section className="sheet admin-sheet location-admin-sheet" onMouseDown={(event) => event.stopPropagation()}>
    <header className="sheet-header"><div><span>{id ? 'Pengaturan Organisasi' : 'Organization Settings'}</span><h2>{id ? 'Lokasi' : 'Locations'}</h2></div><button className="icon-button" onClick={requestClose} aria-label={id ? 'Kembali ke pengaturan organisasi' : 'Back to organization settings'}><X /></button></header>
    <div className="sheet-content location-admin-content">
      <p className="muted">{id ? 'Lakukan semua penambahan, perubahan, dan penghapusan dalam draf ini, lalu simpan semuanya sekaligus.' : 'Make all additions, edits, and removals in this draft, then save them together.'}</p>
      {dirty && <p className="unsaved-banner">{id ? 'Anda memiliki perubahan yang belum disimpan.' : 'You have unsaved changes.'}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}

      <section className="location-admin-section">
        <header><MapPin /><div><h3>{id ? 'Kampus' : 'Campuses'}</h3><p>{id ? 'Lokasi tingkat teratas yang tersedia saat membuat pekerjaan.' : 'Top-level sites available when creating work orders.'}</p></div></header>
        <form className="location-create-row" onSubmit={addCampus}><input aria-label={id ? 'Kode kampus' : 'Campus code'} placeholder={id ? 'Kode' : 'Code'} value={campusDraft.code} onChange={(event) => setCampusDraft((current) => ({ ...current, code: event.target.value }))} required /><input aria-label={id ? 'Nama kampus' : 'Campus name'} placeholder={id ? 'Nama kampus' : 'Campus name'} value={campusDraft.name} onChange={(event) => setCampusDraft((current) => ({ ...current, name: event.target.value }))} required /><button className="secondary-button"><Plus /> {id ? 'Tambahkan ke draf' : 'Add to draft'}</button></form>
        <div className="location-config-list">{data.campuses.map((campus) => <div className="location-config-row" key={campus.id}><input value={campus.code} onChange={(event) => setData((current) => ({ ...current, campuses: current.campuses.map((item) => item.id === campus.id ? { ...item, code: event.target.value } : item) }))} /><input value={campus.name} onChange={(event) => setData((current) => ({ ...current, campuses: current.campuses.map((item) => item.id === campus.id ? { ...item, name: event.target.value } : item) }))} /><label><input type="checkbox" checked={campus.active} onChange={(event) => setData((current) => ({ ...current, campuses: current.campuses.map((item) => item.id === campus.id ? { ...item, active: event.target.checked } : item) }))} /> {id ? 'Aktif' : 'Active'}</label></div>)}</div>
      </section>

      <section className="location-admin-section">
        <header><Building2 /><div><h3>{id ? 'Gedung' : 'Buildings'}</h3><p>{id ? 'Menghapus akan menandai gedung dan semua lokasi di dalamnya untuk dihapus saat disimpan.' : 'Remove stages the building and all its nested locations for deletion on save.'}</p></div></header>
        <form className="location-create-row building-row" onSubmit={addBuilding}><select aria-label={id ? 'Kampus gedung' : 'Building campus'} value={buildingDraft.campusId} onChange={(event) => setBuildingDraft((current) => ({ ...current, campusId: event.target.value }))} required>{data.campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}</option>)}</select><input placeholder={id ? 'Kode' : 'Code'} value={buildingDraft.code} onChange={(event) => setBuildingDraft((current) => ({ ...current, code: event.target.value }))} required /><input placeholder={id ? 'Nama gedung' : 'Building name'} value={buildingDraft.name} onChange={(event) => setBuildingDraft((current) => ({ ...current, name: event.target.value }))} required /><button className="secondary-button"><Plus /> {id ? 'Tambahkan ke draf' : 'Add to draft'}</button></form>
        <div className="location-config-list">{data.buildings.map((building) => <div className="location-config-row building-row" key={building.id}><select value={building.campus_id} onChange={(event) => setData((current) => ({ ...current, buildings: current.buildings.map((item) => item.id === building.id ? { ...item, campus_id: event.target.value } : item) }))}>{data.campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}</option>)}</select><input value={building.code} onChange={(event) => setData((current) => ({ ...current, buildings: current.buildings.map((item) => item.id === building.id ? { ...item, code: event.target.value } : item) }))} /><input value={building.name} onChange={(event) => setData((current) => ({ ...current, buildings: current.buildings.map((item) => item.id === building.id ? { ...item, name: event.target.value } : item) }))} /><label><input type="checkbox" checked={building.active} onChange={(event) => setData((current) => ({ ...current, buildings: current.buildings.map((item) => item.id === building.id ? { ...item, active: event.target.checked } : item) }))} /> {id ? 'Aktif' : 'Active'}</label><button className="icon-button remove-location-button" type="button" onClick={() => removeBuilding(building.id)} aria-label={id ? `Hapus ${building.name}` : `Remove ${building.name}`}><Trash2 /></button></div>)}</div>
      </section>

      <section className="location-admin-section">
        <header><MapPin /><div><h3>{id ? 'Area, lantai, ruangan, dan opsi lainnya' : 'Areas, floors, rooms, and other options'}</h3><p>{id ? 'Menghapus lokasi induk juga akan menghapus semua lokasi di bawahnya saat disimpan.' : 'Removing a parent also removes all nested children when saved.'}</p></div></header>
        <form className="location-option-create" onSubmit={addOption}>
          <select aria-label={id ? 'Gedung lokasi' : 'Location building'} value={optionDraft.buildingId} onChange={(event) => setOptionDraft((current) => ({ ...current, buildingId: event.target.value, parentId: '' }))} required>{data.buildings.map((building) => <option key={building.id} value={building.id}>{data.campuses.find((campus) => campus.id === building.campus_id)?.name} · {building.name}</option>)}</select>
          <div className="parent-cascade">
            <label><span>{id ? 'Tingkat induk' : 'Parent level'}</span><select value={parentCascadeLevels[0]?.selectedId ?? ''} onChange={(event) => selectParentLevel(0, event.target.value)}><option value="">{id ? 'Tanpa induk (tingkat teratas)' : 'No parent (top level)'}</option>{parentCascadeLevels[0]?.options.map((option) => <option key={option.id} value={option.id}>{displayLocationType(option.type_label, locale)}: {option.name}</option>)}</select></label>
            {parentCascadeLevels.slice(1).map((level, index) => <label key={level.parentId ?? `level-${index}`}><span>{id ? `Subtingkat ${index + 1}` : `Sub-level ${index + 1}`}</span><select value={level.selectedId} onChange={(event) => selectParentLevel(index + 1, event.target.value)}><option value="">{id ? 'Gunakan tingkat sebelumnya sebagai induk' : 'Use previous level as parent'}</option>{level.options.map((option) => <option key={option.id} value={option.id}>{displayLocationType(option.type_label, locale)}: {option.name}</option>)}</select></label>)}
          </div>
          <input placeholder={id ? 'Jenis, mis. AREA' : 'Type, e.g. AREA'} value={optionDraft.typeLabel} onChange={(event) => setOptionDraft((current) => ({ ...current, typeLabel: event.target.value }))} required />
          <input placeholder={id ? 'Nama' : 'Name'} value={optionDraft.name} onChange={(event) => setOptionDraft((current) => ({ ...current, name: event.target.value }))} required />
          <input placeholder={id ? 'Kode' : 'Code'} value={optionDraft.code} onChange={(event) => setOptionDraft((current) => ({ ...current, code: event.target.value }))} />
          <input aria-label={id ? 'Urutan' : 'Sort order'} type="number" value={optionDraft.sortOrder} onChange={(event) => setOptionDraft((current) => ({ ...current, sortOrder: event.target.value }))} />
          <button className="secondary-button" disabled={!data.buildings.length}><Plus /> {id ? 'Tambahkan ke draf' : 'Add to draft'}</button>
        </form>
        <div className="location-config-list">{data.buildings.map((building) => <div className="location-building-group" key={building.id}>
          <h4>{data.campuses.find((campus) => campus.id === building.campus_id)?.name} · {building.name}</h4>
          {(orderedOptionsByBuilding.get(building.id) ?? []).filter(isOptionVisible).map((option) => <div className="location-config-row option-row" style={{ marginLeft: `${Math.min(optionDepths.get(option.id) ?? 0, 5) * 22}px` }} key={option.id}>
            <button type="button" className="option-tree-toggle" disabled={!optionHasChildren(option.id)} onClick={() => toggleOption(option.id)} aria-label={`${collapsedOptionIds.has(option.id) ? id ? 'Buka' : 'Expand' : id ? 'Tutup' : 'Collapse'} ${option.name}`}>{optionHasChildren(option.id) ? collapsedOptionIds.has(option.id) ? <ChevronRight /> : <ChevronDown /> : <span />}</button>
            <input value={option.type_label} onChange={(event) => setData((current) => ({ ...current, options: current.options.map((item) => item.id === option.id ? { ...item, type_label: event.target.value } : item) }))} />
            <input value={option.name} onChange={(event) => setData((current) => ({ ...current, options: current.options.map((item) => item.id === option.id ? { ...item, name: event.target.value } : item) }))} />
            <input value={option.code ?? ''} placeholder={id ? 'Kode' : 'Code'} onChange={(event) => setData((current) => ({ ...current, options: current.options.map((item) => item.id === option.id ? { ...item, code: event.target.value || null } : item) }))} />
            <input type="number" value={option.sort_order} onChange={(event) => setData((current) => ({ ...current, options: current.options.map((item) => item.id === option.id ? { ...item, sort_order: Number(event.target.value) } : item) }))} />
            <label><input type="checkbox" checked={option.active} onChange={(event) => setData((current) => ({ ...current, options: current.options.map((item) => item.id === option.id ? { ...item, active: event.target.checked } : item) }))} /> {id ? 'Aktif' : 'Active'}</label>
            <button className="icon-button remove-location-button" type="button" onClick={() => removeOption(option.id)} aria-label={id ? `Hapus ${option.name}` : `Remove ${option.name}`}><Trash2 /></button>
          </div>)}
        </div>)}</div>
      </section>
    </div>
    <footer className="sheet-actions location-save-actions"><span>{dirty ? id ? 'Perubahan lokasi belum disimpan' : 'Unsaved location changes' : id ? 'Semua perubahan telah disimpan' : 'All changes saved'}</span><div><button className="secondary-button" onClick={requestClose}>{id ? 'Tutup' : 'Close'}</button><button className="primary-button" onClick={() => void saveAll()} disabled={!dirty || saving}><Save /> {saving ? id ? 'Menyimpan...' : 'Saving...' : id ? 'Simpan semua perubahan' : 'Save all changes'}</button></div></footer>
  </section></div>;
}
