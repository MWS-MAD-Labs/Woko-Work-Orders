import { useState } from 'react';
import { BriefcaseBusiness, Building2, ChevronRight, ClipboardList, Settings, Users, X } from 'lucide-react';
import { AdminLocations } from './AdminLocations';
import { AdminUsers } from './AdminUsers';
import { AdminWorkSettings } from './AdminWorkSettings';
import { WorkListTemplateForm } from './WorkListTemplateForm';
import type { ReferenceData } from './types';

export function OrganizationSettings({ references, administrator, onClose, onChanged }: { references: ReferenceData; administrator: boolean; onClose: () => void; onChanged: () => Promise<void> | void }) {
  const [section, setSection] = useState<'hub' | 'users' | 'locations' | 'work' | 'work-lists'>('hub');
  if (administrator && section === 'users') return <AdminUsers onClose={() => setSection('hub')} onChanged={onChanged} />;
  if (administrator && section === 'locations') return <AdminLocations onClose={() => setSection('hub')} onChanged={onChanged} />;
  if (administrator && section === 'work') return <AdminWorkSettings onClose={() => setSection('hub')} onChanged={onChanged} />;
  if (section === 'work-lists') return <WorkListTemplateForm references={references} onClose={() => setSection('hub')} />;

  return <div className="sheet-backdrop" onMouseDown={onClose}><section className="sheet organization-settings-sheet" onMouseDown={(event) => event.stopPropagation()}>
    <header className="sheet-header"><div><span>{administrator ? 'Administrator' : 'Facilities Manager'}</span><h2>Organization Settings</h2></div><button className="icon-button" onClick={onClose} aria-label="Close organization settings"><X /></button></header>
    <div className="sheet-content organization-settings-content">
      <div className="organization-settings-intro"><Settings /><div><h3>Configure Woko for your organization</h3><p>Manage access, locations, work options, and recurring operational checklists.</p></div></div>
      <div className="settings-module-list">
        {administrator && <button onClick={() => setSection('users')}><Users /><span><strong>User Access</strong><small>Register users, manage roles, and activate or deactivate access.</small></span><ChevronRight /></button>}
        {administrator && <button onClick={() => setSection('locations')}><Building2 /><span><strong>Locations</strong><small>Configure campuses, buildings, areas, floors, rooms, and nested locations.</small></span><ChevronRight /></button>}
        {administrator && <button onClick={() => setSection('work')}><BriefcaseBusiness /><span><strong>Work Configuration</strong><small>Configure work types, categories, and execution-window choices.</small></span><ChevronRight /></button>}
        <button onClick={() => setSection('work-lists')}><ClipboardList /><span><strong>Work List Templates</strong><small>Create recurring checklists by location and assign the responsible workers.</small></span><ChevronRight /></button>
      </div>
    </div>
  </section></div>;
}
