import { useEffect, useState, type FormEvent } from 'react';
import { Check, Mail, Plus, ShieldCheck, X } from 'lucide-react';
import { roles, type Role } from '@woko/domain';
import { api } from './api';
import type { AdminUser } from './types';

const roleLabels: Record<Role, string> = { ADMINISTRATOR: 'Administrator', FACILITIES_MANAGER: 'Facilities Manager', PERSON_IN_CHARGE: 'Person in Charge', WORKER: 'Worker', OVERSEER: 'Overseer' };

function RoleChecks({ selected, onChange }: { selected: Role[]; onChange: (roles: Role[]) => void }) {
  return <div className="role-checks">{roles.map((role) => <label key={role} title={role === 'WORKER' ? 'Eligible for assignment to internal work orders; does not grant PIC or manager authority.' : undefined}><input type="checkbox" checked={selected.includes(role)} onChange={(event) => onChange(event.target.checked ? [...selected, role] : selected.filter((item) => item !== role))} /> {roleLabels[role]}</label>)}</div>;
}

export function AdminUsers({ onClose, onChanged }: { onClose: () => void; onChanged: () => Promise<void> | void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [newUser, setNewUser] = useState({ fullName: '', email: '', active: true, roles: ['OVERSEER'] as Role[] });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const load = () => api<AdminUser[]>('/admin/users').then(setUsers).catch((caught) => setError(caught instanceof Error ? caught.message : 'Users could not be loaded.'));
  useEffect(() => { void load(); }, []);
  const create = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError(''); setMessage('');
    try {
      await api('/admin/users', { method: 'POST', body: JSON.stringify(newUser) });
      setMessage(`Invitation queued for ${newUser.email}.`);
      setNewUser({ fullName: '', email: '', active: true, roles: ['OVERSEER'] });
      await load();
      await onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'User could not be registered.'); }
    finally { setSaving(false); }
  };
  const update = async (user: AdminUser, active: boolean, updatedRoles: Role[]) => {
    if (!updatedRoles.length) { setError('Every user must have at least one role.'); return; }
    setSaving(true); setError(''); setMessage('');
    try {
      await api(`/admin/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ active, roles: updatedRoles }) });
      await load();
      await onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'User access could not be changed.'); }
    finally { setSaving(false); }
  };
  const resendInvitation = async (user: AdminUser) => {
    setSaving(true); setError(''); setMessage('');
    try {
      await api(`/admin/users/${user.id}/resend-invitation`, { method: 'POST' });
      setMessage(`Invitation queued again for ${user.email}.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Invitation could not be resent.'); }
    finally { setSaving(false); }
  };
  return <div className="sheet-backdrop" onMouseDown={onClose}><section className="sheet admin-sheet" onMouseDown={(event) => event.stopPropagation()}>
    <header className="sheet-header"><div><span>Organization Settings</span><h2>User Access</h2></div><button className="icon-button" onClick={onClose}><X /></button></header>
    <div className="sheet-content admin-users-content">
      <form className="admin-create-user" onSubmit={create}>
        <h3><Plus /> Register user</h3>
        <div className="form-grid"><label className="form-field"><span>Full name *</span><input value={newUser.fullName} onChange={(event) => setNewUser((current) => ({ ...current, fullName: event.target.value }))} minLength={2} required /></label><label className="form-field"><span>School email *</span><input type="email" value={newUser.email} onChange={(event) => setNewUser((current) => ({ ...current, email: event.target.value }))} placeholder="name@millennia21.id" required /></label></div>
        <RoleChecks selected={newUser.roles} onChange={(selectedRoles) => setNewUser((current) => ({ ...current, roles: selectedRoles }))} />
        <button className="primary-button" disabled={saving || !newUser.roles.length}><Plus /> Register</button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="form-success" role="status"><Check /> {message}</p>}
      <div className="admin-user-list">{users.map((user) => <article key={user.id}>
        <div className="admin-user-heading"><span className={`identity-state ${user.identity_linked ? 'linked' : ''}`}>{user.identity_linked ? <Check /> : <ShieldCheck />}{user.identity_linked ? 'Google linked' : 'Awaiting first login'}</span><label className="active-toggle"><input type="checkbox" checked={user.active} disabled={saving} onChange={(event) => void update(user, event.target.checked, user.roles)} /> Active</label></div>
        <strong>{user.full_name}</strong><a href={`mailto:${user.email}`}>{user.email}</a>
        <RoleChecks selected={user.roles} onChange={(selectedRoles) => void update(user, user.active, selectedRoles)} />
        <div className="admin-user-footer"><small>{user.last_login_at ? `Last login ${new Date(user.last_login_at).toLocaleString()}` : 'Never signed in'}</small>{!user.last_login_at && <button type="button" className="secondary-button invitation-button" disabled={saving || !user.active} onClick={() => void resendInvitation(user)}><Mail /> Resend invitation</button>}</div>
      </article>)}</div>
    </div>
  </section></div>;
}
