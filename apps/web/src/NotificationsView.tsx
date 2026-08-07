import { useEffect, useState } from 'react';
import { CheckCheck, MailCheck, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { api } from './api';

export interface NotificationItem {
  id: string;
  work_order_id: string | null;
  work_order_number: string | null;
  type: string;
  title: string;
  message: string;
  read_status: boolean;
  email_status: string;
  email_attempts: number;
  email_last_error: string | null;
  created_at: string;
  read_at: string | null;
  acknowledged_at: string | null;
}

export function NotificationsView({ onClose, onChanged, canRetryEmail }: { onClose: () => void; onChanged: () => void; canRetryEmail: boolean }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [error, setError] = useState('');
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const load = async () => {
    try { setItems(await api<NotificationItem[]>('/notifications')); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load notifications.'); }
  };
  useEffect(() => { void load(); }, []);
  const update = async (id: string, action: 'read' | 'acknowledge') => {
    await api(`/notifications/${id}/${action}`, { method: 'POST' });
    await load();
    onChanged();
  };
  const readAll = async () => {
    await api('/notifications/read-all', { method: 'POST' });
    await load();
    onChanged();
  };
  const retryEmail = async (id: string) => {
    setRetryingId(id);
    setError('');
    try {
      await api(`/notifications/${id}/retry-email`, { method: 'POST' });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not retry email delivery.');
    } finally {
      setRetryingId(null);
    }
  };
  return <div className="sheet-backdrop"><section className="sheet notifications-sheet">
    <header className="sheet-header"><div><span>Updates and reminders</span><h2>Notifications</h2></div><button className="icon-button" onClick={onClose} aria-label="Close notifications"><X /></button></header>
    <div className="sheet-content"><div className="notification-toolbar"><p className="muted">Email delivery state is shown for each notification.</p><button className="secondary-button" onClick={() => void readAll()}><CheckCheck /> Mark all read</button></div>{error && <p className="form-error">{error}</p>}<div className="notification-list">{items.map((item) => <article className={`${item.read_status ? 'notification-card' : 'notification-card unread'}${item.type === 'WORK_LIST_MISSED_DIGEST' ? ' informational' : ''}`} key={item.id}><div><span>{item.work_order_number ?? item.type.replaceAll('_', ' ')}</span><h3>{item.title}</h3><p>{item.message}</p><small>{formatDistanceToNow(new Date(item.created_at), { addSuffix: true })} · Email {item.email_status.toLowerCase()}{item.email_status === 'RETRYING' ? ` (attempt ${item.email_attempts})` : ''}</small>{item.email_last_error && <small className="form-error">Email delivery detail: {item.email_last_error}</small>}</div><div className="notification-actions">{canRetryEmail && item.email_status === 'FAILED' && <button className="secondary-button" onClick={() => void retryEmail(item.id)} disabled={retryingId === item.id}>{retryingId === item.id ? 'Retrying…' : 'Retry email'}</button>}{!item.read_status && <button className="secondary-button" onClick={() => void update(item.id, 'read')}>Mark read</button>}{item.type !== 'WORK_LIST_MISSED_DIGEST' && !item.acknowledged_at && <button className="primary-button" onClick={() => void update(item.id, 'acknowledge')}><MailCheck /> Acknowledge</button>}</div></article>)}</div>{!items.length && !error && <p className="empty-approval">No notifications yet.</p>}</div>
  </section></div>;
}
