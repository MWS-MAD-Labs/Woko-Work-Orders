import { useEffect, useState, type FormEvent } from 'react';
import { Check, Mail, Plus, ShieldCheck, X } from 'lucide-react';
import { permissionBundles, permissionGroups, withoutDependents, withRequirements, type Permission, type PermissionBundle } from '@woko/domain';
import { api } from './api';
import type { Locale } from './i18n';
import { bundleLabels, groupLabels, permissionLabels } from './permission-labels';
import type { AdminUser } from './types';

function PermissionChecks({ selected, locale, onChange, readOnly = false }: { selected: readonly Permission[]; locale: Locale; onChange: (permissions: Permission[]) => void; readOnly?: boolean }) {
  const id = locale === 'id';
  const toggle = (permission: Permission, on: boolean) => onChange(on ? withRequirements(selected, permission) : withoutDependents(selected, permission));
  return <div className="permission-checks">
    {!readOnly && <div className="bundle-buttons" role="group" aria-label={id ? 'Isi dari paket' : 'Fill from a bundle'}>
      <span>{id ? 'Isi dari paket:' : 'Fill from a bundle:'}</span>
      {(Object.keys(permissionBundles) as PermissionBundle[]).map((bundle) => <button key={bundle} type="button" className="secondary-button" onClick={() => onChange([...permissionBundles[bundle]])}>{bundleLabels[locale][bundle]}</button>)}
    </div>}
    {permissionGroups.map((group) => <fieldset key={group.key} className="role-checks"><legend>{groupLabels[locale][group.key]}</legend>{group.permissions.map((permission) => <label key={permission} title={permissionLabels[locale][permission].help}><input type="checkbox" checked={selected.includes(permission)} disabled={readOnly} onChange={(event) => toggle(permission, event.target.checked)} /> {permissionLabels[locale][permission].name}</label>)}</fieldset>)}
  </div>;
}

export function AdminUsers({ locale, managedByCentral = false, onClose, onChanged }: { locale: Locale; managedByCentral?: boolean; onClose: () => void; onChanged: () => Promise<void> | void }) {
  const id = locale === 'id';
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [newUser, setNewUser] = useState({ fullName: '', email: '', active: true, permissions: [...permissionBundles.overseer] as Permission[] });
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
      setNewUser({ fullName: '', email: '', active: true, permissions: [...permissionBundles.overseer] });
      await load();
      await onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : id ? 'Pengguna tidak dapat didaftarkan.' : 'User could not be registered.'); }
    finally { setSaving(false); }
  };
  const update = async (user: AdminUser, active: boolean, updatedPermissions: Permission[]) => {
    if (!updatedPermissions.length) { setError(id ? 'Setiap pengguna harus memiliki setidaknya satu izin.' : 'Every user must have at least one permission.'); return; }
    setSaving(true); setError(''); setMessage('');
    try {
      await api(`/admin/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ active, permissions: updatedPermissions }) });
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
      {managedByCentral && <p className="form-success" role="status"><ShieldCheck /> {id ? 'Siapa yang boleh memakai Woko dan apa yang boleh dilakukan diatur di Central. Daftar ini hanya untuk dilihat.' : 'Who may use Woko and what they may do is set in Central. This list is for viewing only.'}</p>}
      {!managedByCentral && <form className="admin-create-user" onSubmit={create}>
        <h3><Plus /> {id ? 'Daftarkan pengguna' : 'Register user'}</h3>
        <div className="form-grid"><label className="form-field"><span>{id ? 'Nama lengkap *' : 'Full name *'}</span><input value={newUser.fullName} onChange={(event) => setNewUser((current) => ({ ...current, fullName: event.target.value }))} minLength={2} required /></label><label className="form-field"><span>{id ? 'Email sekolah *' : 'School email *'}</span><input type="email" value={newUser.email} onChange={(event) => setNewUser((current) => ({ ...current, email: event.target.value }))} placeholder="name@millennia21.id" required /></label></div>
        <PermissionChecks selected={newUser.permissions} locale={locale} onChange={(selected) => setNewUser((current) => ({ ...current, permissions: selected }))} />
        <button className="primary-button" disabled={saving || !newUser.permissions.length}><Plus /> {id ? 'Daftarkan' : 'Register'}</button>
      </form>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="form-success" role="status"><Check /> {message}</p>}
      <div className="admin-user-list">{users.map((user) => <article key={user.id}>
        <div className="admin-user-heading"><span className={`identity-state ${user.identity_linked ? 'linked' : ''}`}>{user.identity_linked ? <Check /> : <ShieldCheck />}{user.identity_linked ? id ? managedByCentral ? 'Terhubung ke Central' : 'Terhubung ke Google' : managedByCentral ? 'Linked to Central' : 'Google linked' : id ? 'Menunggu login pertama' : 'Awaiting first login'}</span><label className="active-toggle"><input type="checkbox" checked={user.active} disabled={saving || managedByCentral} onChange={(event) => void update(user, event.target.checked, user.permissions)} /> {id ? 'Aktif' : 'Active'}</label></div>
        <strong>{user.full_name}</strong><a href={`mailto:${user.email}`}>{user.email}</a>
        <PermissionChecks selected={user.permissions} locale={locale} readOnly={managedByCentral} onChange={(selected) => void update(user, user.active, selected)} />
        <div className="admin-user-footer"><small>{user.last_login_at ? `${id ? 'Login terakhir' : 'Last login'} ${new Date(user.last_login_at).toLocaleString(id ? 'id-ID' : undefined)}` : id ? 'Belum pernah login' : 'Never signed in'}</small>{!managedByCentral && !user.last_login_at && <button type="button" className="secondary-button invitation-button" disabled={saving || !user.active} onClick={() => void resendInvitation(user)}><Mail /> {id ? 'Kirim ulang undangan' : 'Resend invitation'}</button>}</div>
      </article>)}</div>
    </div>
  </section></div>;
}
