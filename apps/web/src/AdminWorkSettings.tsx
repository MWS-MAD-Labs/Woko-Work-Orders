import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Save, Trash2, X } from 'lucide-react';
import { api } from './api';
import type { AdminWorkOption } from './types';

const fixedTypes = new Set(['WORK_TYPE', 'EXECUTION_WINDOW']);
const createId = () => crypto.randomUUID();

export function AdminWorkSettings({ onClose, onChanged }: { onClose: () => void; onChanged: () => Promise<void> | void }) {
  const [options, setOptions] = useState<AdminWorkOption[]>([]);
  const [saved, setSaved] = useState('[]');
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [newCategory, setNewCategory] = useState({ code: '', label: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = JSON.stringify(options) !== saved || removedIds.length > 0;

  const load = async () => {
    try {
      const loaded = await api<AdminWorkOption[]>('/admin/work-settings');
      setOptions(loaded); setSaved(JSON.stringify(loaded)); setRemovedIds([]); setError('');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Work configuration could not be loaded.'); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const update = (id: string, values: Partial<AdminWorkOption>) => setOptions((current) => current.map((option) => option.id === id ? { ...option, ...values } : option));
  const addCategory = (event: FormEvent) => {
    event.preventDefault();
    setOptions((current) => [...current, { id: createId(), option_type: 'CATEGORY', code: newCategory.code.trim().toUpperCase().replaceAll(/[^A-Z0-9]+/g, '_'), label: newCategory.label.trim(), active: true, sort_order: current.filter((option) => option.option_type === 'CATEGORY').length * 10 + 10 }]);
    setNewCategory({ code: '', label: '' });
  };
  const removeCategory = (id: string) => {
    if (saved.includes(id)) setRemovedIds((current) => [...new Set([...current, id])]);
    setOptions((current) => current.filter((option) => option.id !== id));
  };
  const saveAll = async () => {
    setSaving(true); setError('');
    try {
      await api('/admin/work-settings', { method: 'PUT', body: JSON.stringify({ options: options.map((option) => ({ id: option.id, optionType: option.option_type, code: option.code, label: option.label, active: option.active, sortOrder: option.sort_order })), removedIds }) });
      await load(); await onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Work configuration could not be saved.'); }
    finally { setSaving(false); }
  };

  const requestClose = () => {
    if (dirty && !window.confirm('You have unsaved work configuration changes. Discard them and go back?')) return;
    onClose();
  };
  const groups: Array<{ type: AdminWorkOption['option_type']; title: string; description: string }> = [
    { type: 'WORK_TYPE', title: 'Types of work', description: 'Rename or disable Internal and Vendor choices. Their workflow behavior remains fixed.' },
    { type: 'CATEGORY', title: 'Work categories', description: 'Add, rename, deactivate, or remove categories available on new work orders.' },
    { type: 'EXECUTION_WINDOW', title: 'Execution windows', description: 'Rename or disable scheduling restrictions used by new work orders.' },
  ];

  return <div className="sheet-backdrop" onMouseDown={requestClose}><section className="sheet admin-sheet" onMouseDown={(event) => event.stopPropagation()}>
    <header className="sheet-header"><div><span>Organization Settings</span><h2>Work Configuration</h2></div><button className="icon-button" onClick={requestClose}><X /></button></header>
    <div className="sheet-content settings-panel">
    <header><div><h3>Work configuration</h3><p>Control the options available when creating new work orders.</p></div></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {groups.map((group) => <section className="work-settings-group" key={group.type}>
      <header><div><h4>{group.title}</h4><p>{group.description}</p></div></header>
      {group.type === 'CATEGORY' && <form className="work-option-add" onSubmit={addCategory}><input placeholder="Code, e.g. LANDSCAPING" value={newCategory.code} onChange={(event) => setNewCategory((current) => ({ ...current, code: event.target.value }))} required /><input placeholder="Display label" value={newCategory.label} onChange={(event) => setNewCategory((current) => ({ ...current, label: event.target.value }))} required /><button className="secondary-button"><Plus /> Add category</button></form>}
      <div className="work-option-list">{options.filter((option) => option.option_type === group.type).map((option) => <div className="work-option-row" key={option.id}><input value={option.code} disabled={fixedTypes.has(group.type)} onChange={(event) => update(option.id, { code: event.target.value.toUpperCase() })} /><input value={option.label} onChange={(event) => update(option.id, { label: event.target.value })} /><input aria-label="Sort order" type="number" value={option.sort_order} onChange={(event) => update(option.id, { sort_order: Number(event.target.value) })} /><label><input type="checkbox" checked={option.active} onChange={(event) => update(option.id, { active: event.target.checked })} /> Active</label>{group.type === 'CATEGORY' ? <button className="icon-button remove-location-button" onClick={() => removeCategory(option.id)} aria-label={`Remove ${option.label}`}><Trash2 /></button> : <span />}</div>)}</div>
    </section>)}
    </div>
    <footer className="sheet-actions settings-save-row"><span>{dirty ? 'Unsaved work configuration' : 'All changes saved'}</span><div><button className="secondary-button" onClick={requestClose}>Back</button><button className="primary-button" onClick={() => void saveAll()} disabled={!dirty || saving}><Save /> {saving ? 'Saving...' : 'Save work configuration'}</button></div></footer>
  </section></div>;
}
