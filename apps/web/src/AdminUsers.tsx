import { useEffect, useState, type FormEvent } from 'react';
import { Check, Mail, Plus, ShieldCheck, X } from 'lucide-react';
import { roles, type Role } from '@woko/domain';
import { api } from './api';
import type { Locale } from './i18n';
import type { AdminUser } from './types';

const roleLabels: Record<Locale, Record<Role, string>> = {
  en: { ADMINISTRATOR: 'Administrator', FACILITIES_MANAGER: 'Facilities Manager', PERSON_IN_CHARGE: 'Person in Charge', WORKER: 'Worker', OVERSEER: 'Overseer' },
  id: { ADMINISTRATOR: 'Administrator', FACILITIES_MANAGER: 'Manajer Fasilitas', PERSON_IN_CHARGE: 'Penanggung Jawab', WORKER: 'Pekerja', OVERSEER: 'Pengawas' },
};

function RoleChecks({ selected, locale, onChange }: { selected: Role[]; locale: Locale; onChange: (roles: Role[]) => void }) {
  const id = locale === 'id';
  return <div className="role-checks">{roles.map((role) => <label key={role} title={role === 'WORKER' ? id ? 'Dapat ditugaskan ke pekerjaan internal; tidak memberikan wewenang sebagai PIC atau manajer.' : 'Eligible for assignment to internal work orders; does not grant PIC or manager authority.' : undefined}><input type="checkbox" checked={selected.includes(role)} onChange={(event) => onChange(event.target.checked ? [...selected, role] : selected.filter((item) => item !== role))} /> {roleLabels[locale][role]}</label>)}</div>;
}

export function AdminUsers({ locale, onClose, onChanged }: { locale: Locale; onClose: () => void; onChanged: () => Promise<void> | void }) {
  const id = locale === 'id';
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [newUser, setNewUser] = useState({ fullName: '', email: '', active: true, roles: ['OVERSEER'] as Role[] });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const load = () => api<AdminUser[]>('/admin/users').then(setUsers).catch((caught) => setError(caught instanceof Error ? caught.message : id ? 'Pengguna tidak dapat dimuat.' : 'Users could not be loaded.'));
  useEffect(() => { void load(); }, []);
  const create = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError(''); setMessage('');
    try {
      await api('/admin/users', { method: 'POST', body: JSON.stringify(newUser) });
      setMessage(id ? `Undangan untuk ${newUser.email} telah dimasukkan ke antrean.` : `Invitation queued for ${newUser.email}.`);
      setNewUser({ fullName: '', email: '', active: true, roles: ['OVERSEER'] });
      await load();
      await onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : id ? 'Pengguna tidak dapat didaftarkan.' : 'User could not be registered.'); }
    finally { setSaving(false); }
  };
  const update = async (user: AdminUser, active: boolean, updatedRoles: Role[]) => {
    if (!updatedRoles.length) { setError(id ? 'Setiap pengguna harus memiliki setidaknya satu peran.' : 'Every user must have at least one role.'); return; }
    setSaving(true); setError(''); setMessage('');
    try {
      await api(`/admin/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ active, roles: updatedRoles }) });
      await load();
      await onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : id ? 'Akses pengguna tidak dapat diubah.' : 'User access could not be changed.'); }
    finally { setSaving(false); }
  };
  const resendInvitation = async (user: AdminUser) => {
    setSaving(true); setError(''); setMessage('');
    try {
      await api(`/admin/users/${user.id}/resend-invitation`, { method: 'POST' });
      setMessage(id ? `Undangan untuk ${user.email} telah dimasukkan kembali ke antrean.` : `Invitation queued again for ${user.email}.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : id ? 'Undangan tidak dapat dikirim ulang.' : 'Invitation could not be resent.'); }
    finally { setSaving(false); }
  };
  return <div className="sheet-backdrop" onMouseDown={onClose}><section className="sheet admin-sheet" onMouseDown={(event) => event.stopPropagation()}>
    <header className="sheet-header"><div><span>{id ? 'Pengaturan Organisasi' : 'Organization Settings'}</span><h2>{id ? 'Akses Pengguna' : 'User Access'}</h2></div><button className="icon-button" onClick={onClose} aria-label={id ? 'Kembali ke pengaturan organisasi' : 'Back to organization settings'}><X /></button></header>
    <div className="sheet-content admin-users-content">
      <form className="admin-create-user" onSubmit={create}>
        <h3><Plus /> {id ? 'Daftarkan pengguna' : 'Register user'}</h3>
        <div className="form-grid"><label className="form-field"><span>{id ? 'Nama lengkap *' : 'Full name *'}</span><input value={newUser.fullName} onChange={(event) => setNewUser((current) => ({ ...current, fullName: event.target.value }))} minLength={2} required /></label><label className="form-field"><span>{id ? 'Email sekolah *' : 'School email *'}</span><input type="email" value={newUser.email} onChange={(event) => setNewUser((current) => ({ ...current, email: event.target.value }))} placeholder="name@millennia21.id" required /></label></div>
        <RoleChecks selected={newUser.roles} locale={locale} onChange={(selectedRoles) => setNewUser((current) => ({ ...current, roles: selectedRoles }))} />
        <button className="primary-button" disabled={saving || !newUser.roles.length}><Plus /> {id ? 'Daftarkan' : 'Register'}</button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="form-success" role="status"><Check /> {message}</p>}
      <div className="admin-user-list">{users.map((user) => <article key={user.id}>
        <div className="admin-user-heading"><span className={`identity-state ${user.identity_linked ? 'linked' : ''}`}>{user.identity_linked ? <Check /> : <ShieldCheck />}{user.identity_linked ? id ? 'Terhubung ke Google' : 'Google linked' : id ? 'Menunggu login pertama' : 'Awaiting first login'}</span><label className="active-toggle"><input type="checkbox" checked={user.active} disabled={saving} onChange={(event) => void update(user, event.target.checked, user.roles)} /> {id ? 'Aktif' : 'Active'}</label></div>
        <strong>{user.full_name}</strong><a href={`mailto:${user.email}`}>{user.email}</a>
        <RoleChecks selected={user.roles} locale={locale} onChange={(selectedRoles) => void update(user, user.active, selectedRoles)} />
        <div className="admin-user-footer"><small>{user.last_login_at ? `${id ? 'Login terakhir' : 'Last login'} ${new Date(user.last_login_at).toLocaleString(id ? 'id-ID' : undefined)}` : id ? 'Belum pernah login' : 'Never signed in'}</small>{!user.last_login_at && <button type="button" className="secondary-button invitation-button" disabled={saving || !user.active} onClick={() => void resendInvitation(user)}><Mail /> {id ? 'Kirim ulang undangan' : 'Resend invitation'}</button>}</div>
      </article>)}</div>
    </div>
  </section></div>;
}
