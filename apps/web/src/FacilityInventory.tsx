import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Plus, Save } from 'lucide-react';
import { api } from './api';
import { assetCategory, FacilityAssetFilters, matchesAsset } from './FacilityAssetFilters';
import type { FacilityAsset } from './FacilitiesView';
import type { Locale } from './i18n';

export function FacilityInventory({ assets, locale, onChanged, onError }: { assets: FacilityAsset[]; locale: Locale; onChanged: () => Promise<void>; onError: (value: string) => void }) {
  const isId = locale === 'id';
  const t = isId ? { name: 'Nama aset', code: 'Kode aset', category: 'Kategori', quantity: 'Jumlah tersedia', active: 'Aktif', inactive: 'Tidak aktif', add: 'Tambah aset', save: 'Simpan', empty: 'Tidak ada item yang cocok.' } : { name: 'Asset name', code: 'Asset code', category: 'Category', quantity: 'Available quantity', active: 'Active', inactive: 'Inactive', add: 'Add asset', save: 'Save', empty: 'No matching items.' };
  const emptyAsset = () => ({ name: '', assetCode: '', category: '', quantity: 1, active: true });
  const [drafts, setDrafts] = useState(assets);
  const [newAsset, setNewAsset] = useState(emptyAsset);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [saving, setSaving] = useState(false);
  const dirtyIds = useRef(new Set<string>());
  const listId = useId();
  useEffect(() => setDrafts((current) => assets.map((asset) => dirtyIds.current.has(asset.id) ? current.find((draft) => draft.id === asset.id) ?? asset : asset)), [assets]);
  const update = (id: string, fields: Partial<FacilityAsset>) => {
    dirtyIds.current.add(id);
    setDrafts((current) => current.map((item) => item.id === id ? { ...item, ...fields } : item));
  };
  const save = async (asset: FacilityAsset) => {
    setSaving(true);
    try { await api(`/facilities/assets/${asset.id}`, { method: 'PUT', body: JSON.stringify({ name: asset.name, assetCode: asset.asset_code, category: assetCategory(asset), quantity: asset.quantity, active: asset.active }) }); dirtyIds.current.delete(asset.id); await onChanged(); }
    catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  };
  const add = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true);
    try { await api('/facilities/assets', { method: 'POST', body: JSON.stringify(newAsset) }); setNewAsset(emptyAsset()); await onChanged(); }
    catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  };
  const visible = drafts.filter((asset) => matchesAsset(assets.find((persisted) => persisted.id === asset.id) ?? asset, search, category));
  return <>
    <datalist id={listId}>{[...new Set(assets.map(assetCategory))].sort().map((value) => <option value={value} key={value} />)}</datalist>
    <form className="facility-inventory-add" onSubmit={add}>
      <input aria-label={t.name} placeholder={t.name} value={newAsset.name} maxLength={160} onChange={(event) => setNewAsset({ ...newAsset, name: event.target.value })} required />
      <input aria-label={t.code} placeholder={t.code} value={newAsset.assetCode} maxLength={80} onChange={(event) => setNewAsset({ ...newAsset, assetCode: event.target.value })} required />
      <input aria-label={t.category} placeholder={t.category} list={listId} maxLength={80} value={newAsset.category} onChange={(event) => setNewAsset({ ...newAsset, category: event.target.value })} />
      <input aria-label={t.quantity} type="number" min="0" value={newAsset.quantity} onChange={(event) => setNewAsset({ ...newAsset, quantity: Number(event.target.value) })} required />
      <button className="primary-button" disabled={saving}><Plus /> {t.add}</button>
    </form>
    <FacilityAssetFilters assets={assets} locale={locale} search={search} category={category} onSearch={setSearch} onCategory={setCategory} />
    <fieldset disabled={saving} className="facility-inventory-editor"><div className="facility-inventory-list">{visible.map((asset, index) => <div key={asset.id}>
      <input aria-label={`${t.name} ${index + 1}`} value={asset.name} maxLength={160} onChange={(event) => update(asset.id, { name: event.target.value })} />
      <input aria-label={`${t.code} ${index + 1}`} value={asset.asset_code} maxLength={80} onChange={(event) => update(asset.id, { asset_code: event.target.value })} />
      <input aria-label={`${t.category} ${index + 1}`} value={asset.category ?? 'Uncategorized'} list={listId} maxLength={80} onChange={(event) => update(asset.id, { category: event.target.value })} />
      <input aria-label={`${t.quantity} ${index + 1}`} type="number" min="0" value={asset.quantity} onChange={(event) => update(asset.id, { quantity: Number(event.target.value) })} />
      <label><input aria-label={`${t.active} ${index + 1}`} type="checkbox" checked={asset.active} onChange={(event) => update(asset.id, { active: event.target.checked })} /> {asset.active ? t.active : t.inactive}</label>
      <button className="secondary-button" disabled={saving} type="button" onClick={() => void save(asset)}><Save /> {t.save}</button>
    </div>)}</div></fieldset>{!visible.length && <p>{t.empty}</p>}
  </>;
}
