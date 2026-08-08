import { useState } from 'react';
import { BriefcaseBusiness, Building2, ChevronRight, ClipboardList, Settings, Users, X } from 'lucide-react';
import { AdminLocations } from './AdminLocations';
import { AdminUsers } from './AdminUsers';
import { AdminWorkSettings } from './AdminWorkSettings';
import { WorkListTemplateForm } from './WorkListTemplateForm';
import type { Locale } from './i18n';
import type { ReferenceData } from './types';

type OrganizationSettingsProps = { references: ReferenceData; administrator: boolean; locale?: Locale; onClose: () => void; onChanged: () => Promise<void> | void };

export function OrganizationSettings({ references, administrator, locale = 'en', onClose, onChanged }: OrganizationSettingsProps) {
  const [section, setSection] = useState<'hub' | 'users' | 'locations' | 'work' | 'work-lists'>('hub');
  const id = locale === 'id';
  if (administrator && section === 'users') return <AdminUsers locale={locale} onClose={() => setSection('hub')} onChanged={onChanged} />;
  if (administrator && section === 'locations') return <AdminLocations locale={locale} onClose={() => setSection('hub')} onChanged={onChanged} />;
  if (administrator && section === 'work') return <AdminWorkSettings locale={locale} onClose={() => setSection('hub')} onChanged={onChanged} />;
  if (section === 'work-lists') return <WorkListTemplateForm references={references} locale={locale} onClose={() => setSection('hub')} />;

  return <div className="sheet-backdrop" onMouseDown={onClose}><section className="sheet organization-settings-sheet" onMouseDown={(event) => event.stopPropagation()}>
    <header className="sheet-header"><div><span>{administrator ? 'Administrator' : id ? 'Manajer Fasilitas' : 'Facilities Manager'}</span><h2>{id ? 'Pengaturan Organisasi' : 'Organization Settings'}</h2></div><button className="icon-button" onClick={onClose} aria-label={id ? 'Tutup pengaturan organisasi' : 'Close organization settings'}><X /></button></header>
    <div className="sheet-content organization-settings-content">
      <div className="organization-settings-intro"><Settings /><div><h3>{id ? 'Konfigurasikan Woko untuk organisasi Anda' : 'Configure Woko for your organization'}</h3><p>{id ? 'Kelola akses, lokasi, opsi pekerjaan, dan daftar periksa operasional berulang.' : 'Manage access, locations, work options, and recurring operational checklists.'}</p></div></div>
      <div className="settings-module-list">
        {administrator && <button onClick={() => setSection('users')}><Users /><span><strong>{id ? 'Akses Pengguna' : 'User Access'}</strong><small>{id ? 'Daftarkan pengguna, kelola peran, serta aktifkan atau nonaktifkan akses.' : 'Register users, manage roles, and activate or deactivate access.'}</small></span><ChevronRight /></button>}
        {administrator && <button onClick={() => setSection('locations')}><Building2 /><span><strong>{id ? 'Lokasi' : 'Locations'}</strong><small>{id ? 'Konfigurasikan kampus, gedung, area, lantai, ruangan, dan lokasi bertingkat.' : 'Configure campuses, buildings, areas, floors, rooms, and nested locations.'}</small></span><ChevronRight /></button>}
        {administrator && <button onClick={() => setSection('work')}><BriefcaseBusiness /><span><strong>{id ? 'Konfigurasi Pekerjaan' : 'Work Configuration'}</strong><small>{id ? 'Konfigurasikan jenis pekerjaan, kategori, dan pilihan waktu pelaksanaan.' : 'Configure work types, categories, and execution-window choices.'}</small></span><ChevronRight /></button>}
        <button onClick={() => setSection('work-lists')}><ClipboardList /><span><strong>{id ? 'Templat Pekerjaan Rutin' : 'Routine Work Templates'}</strong><small>{id ? 'Buat daftar periksa berulang berdasarkan lokasi dan tetapkan pekerja yang bertanggung jawab.' : 'Create recurring checklists by location and assign the responsible workers.'}</small></span><ChevronRight /></button>
      </div>
    </div>
  </section></div>;
}
