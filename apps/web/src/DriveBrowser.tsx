import { useEffect, useRef, useState } from 'react';
import { ExternalLink, FolderSearch, LoaderCircle } from 'lucide-react';
import { api } from './api';
import type { Locale } from './i18n';

declare global {
  interface Window {
    gapi?: { load: (module: string, options: (() => void) | { callback: () => void; onerror?: () => void; timeout?: number; ontimeout?: () => void }) => void };
    google?: any;
  }
}

export interface DriveBrowserItem {
  id: string;
  name: string;
  mimeType: string;
  url: string | null;
}

interface PickerConfig {
  clientId: string;
  apiKey: string;
  appId: string;
  email: string;
}

interface DriveBrowserProps {
  locale: Locale;
  title?: string;
  onClose: () => void;
  onSelect: (file: DriveBrowserItem, accessToken: string) => void;
}

let scriptsPromise: Promise<void> | undefined;

const driveTokenStoragePrefix = 'woko:drive-token:';
type CachedDriveToken = { accessToken: string; expiresAt: number };

function readCachedDriveToken(email: string): CachedDriveToken | undefined {
  try {
    const raw = window.sessionStorage.getItem(`${driveTokenStoragePrefix}${email.toLowerCase()}`);
    if (!raw) return undefined;
    const cached = JSON.parse(raw) as CachedDriveToken;
    if (!cached.accessToken || cached.expiresAt <= Date.now() + 60_000) {
      window.sessionStorage.removeItem(`${driveTokenStoragePrefix}${email.toLowerCase()}`);
      return undefined;
    }
    return cached;
  } catch {
    return undefined;
  }
}

function cacheDriveToken(email: string, accessToken: string, expiresInSeconds: number): void {
  try {
    window.sessionStorage.setItem(`${driveTokenStoragePrefix}${email.toLowerCase()}`, JSON.stringify({
      accessToken,
      expiresAt: Date.now() + expiresInSeconds * 1000,
    } satisfies CachedDriveToken));
  } catch {
    // Picker still works when browser storage is unavailable; it will request a token again next time.
  }
}

function loadGoogleScripts(): Promise<void> {
  scriptsPromise ??= new Promise((resolve, reject) => {
    let pickerReady = Boolean(window.google?.picker);
    let identityReady = Boolean(window.google?.accounts?.oauth2);
    const timeout = window.setTimeout(() => reject(new Error('DRIVE_PICKER_TIMEOUT')), 12_000);
    const done = () => {
      if (pickerReady && identityReady) {
        window.clearTimeout(timeout);
        resolve();
      }
    };
    const fail = () => {
      window.clearTimeout(timeout);
      reject(new Error('DRIVE_SCRIPTS_FAILED'));
    };

    const initializePicker = () => window.gapi?.load('picker', {
      callback: () => { pickerReady = true; done(); },
      onerror: fail,
      timeout: 10_000,
      ontimeout: fail,
    });
    if (pickerReady) done();
    else if (window.gapi) initializePicker();
    else {
      const script = document.createElement('script');
      script.src = 'https://apis.google.com/js/api.js';
      script.async = true;
      script.onload = initializePicker;
      script.onerror = fail;
      document.head.appendChild(script);
    }

    if (!identityReady) {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => { identityReady = true; done(); };
      script.onerror = fail;
      document.head.appendChild(script);
    } else done();
  });
  return scriptsPromise;
}

export function DriveBrowser({ locale, title, onClose, onSelect }: DriveBrowserProps) {
  const copy = locale === 'id'
    ? { defaultTitle: 'Pilih dari Google Drive', preparing: 'Menyiapkan Google Drive…', pickerNotReady: 'Google Picker belum siap. Tutup panel ini lalu coba lagi.', pickerOpen: 'Google Picker terbuka.', permissionDenied: 'Izin Google Drive tidak diberikan', popupBlocked: 'Popup otorisasi Google diblokir. Izinkan popup untuk Woko lalu coba lagi.', popupClosed: 'Jendela otorisasi Google ditutup sebelum akses Drive selesai.', authorizationFailed: (type: string) => `Otorisasi Google tidak dapat dibuka (${type}). Pastikan URL Woko ini terdaftar persis sebagai origin JavaScript OAuth.`, opening: 'Membuka Google Drive…', accessRequired: 'Akses Google Drive diperlukan', openFailed: 'Google Drive tidak dapat dibuka.', connecting: 'Menghubungkan ke Google Drive…', close: 'Tutup', connect: 'Hubungkan Google Drive', tokenHint: 'Otorisasi Google hanya diminta jika tab browser ini tidak memiliki token akses Drive yang masih berlaku.', loading: 'Memuat Google Identity Services dan Picker…', openDrive: 'Buka Google Drive', timeout: 'Waktu penyiapan Google Picker habis. Periksa pemblokiran popup dan konsol browser.', scriptsFailed: 'Skrip Google Drive tidak dapat dimuat.' }
    : { defaultTitle: 'Choose from Google Drive', preparing: 'Preparing Google Drive…', pickerNotReady: 'Google Picker is not ready. Close this panel and try again.', pickerOpen: 'Google Picker is open.', permissionDenied: 'Google Drive permission was not granted', popupBlocked: 'The Google authorization popup was blocked. Allow popups for Woko and try again.', popupClosed: 'The Google authorization window was closed before Drive access completed.', authorizationFailed: (type: string) => `Google authorization could not be opened (${type}). Check that this exact Woko URL is registered as an OAuth JavaScript origin.`, opening: 'Opening Google Drive…', accessRequired: 'Google Drive access required', openFailed: 'Google Drive could not be opened.', connecting: 'Connecting to Google Drive…', close: 'Close', connect: 'Connect Google Drive', tokenHint: 'Google authorization is only requested when this browser tab does not have a valid Drive access token.', loading: 'Loading Google Identity Services and Picker…', openDrive: 'Open Google Drive', timeout: 'Google Picker initialization timed out. Check popup blocking and the browser console.', scriptsFailed: 'Google Drive scripts could not be loaded.' };
  const pickerTitle = title ?? copy.defaultTitle;
  const [status, setStatus] = useState(copy.preparing);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const configRef = useRef<PickerConfig | null>(null);
  const tokenClientRef = useRef<any>(null);
  const onCloseRef = useRef(onClose);
  const onSelectRef = useRef(onSelect);
  onCloseRef.current = onClose;
  onSelectRef.current = onSelect;

  const showPicker = (accessToken: string) => {
    const config = configRef.current;
    if (!config || !window.google?.picker) {
      setError(copy.pickerNotReady);
      return;
    }
    const view = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
      .setOwnedByMe(true)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false);
    const picker = new window.google.picker.PickerBuilder()
      .setTitle(pickerTitle)
      .setDeveloperKey(config.apiKey)
      .setAppId(config.appId)
      .setOAuthToken(accessToken)
      .enableFeature(window.google.picker.Feature.SUPPORT_DRIVES)
      .addView(view)
      .addView(new window.google.picker.DocsUploadView())
      .setCallback((data: any) => {
        if (data.action === window.google.picker.Action.PICKED) {
          const selected = data[window.google.picker.Response.DOCUMENTS]?.[0];
          if (selected) onSelectRef.current({
            id: selected[window.google.picker.Document.ID],
            name: selected[window.google.picker.Document.NAME],
            mimeType: selected[window.google.picker.Document.MIME_TYPE],
            url: selected[window.google.picker.Document.URL] ?? null,
          }, accessToken);
        } else if (data.action === window.google.picker.Action.CANCEL) onCloseRef.current();
      })
      .build();
    picker.setVisible(true);
    setStatus(copy.pickerOpen);
  };

  useEffect(() => {
    let active = true;
    Promise.all([api<PickerConfig>('/google-picker/config'), loadGoogleScripts()])
      .then(([config]) => {
        if (!active || !window.google?.accounts?.oauth2) return;
        configRef.current = config;
        tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
          client_id: config.clientId,
          scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email',
          login_hint: config.email,
          hd: config.email.split('@')[1],
          callback: (response: { access_token?: string; expires_in?: number; error?: string }) => {
            if (!active) return;
            if (response.error || !response.access_token) {
              setError(`${copy.permissionDenied}${response.error ? ` (${response.error})` : ''}.`);
              return;
            }
            cacheDriveToken(config.email, response.access_token, response.expires_in ?? 3600);
            showPicker(response.access_token);
          },
          error_callback: (response: { type?: string }) => {
            if (!active) return;
            const message = response.type === 'popup_failed_to_open'
              ? copy.popupBlocked
              : response.type === 'popup_closed'
                ? copy.popupClosed
                : copy.authorizationFailed(response.type ?? (locale === 'id' ? 'tidak diketahui' : 'unknown'));
            setError(message);
          },
        });
        const cachedToken = readCachedDriveToken(config.email);
        if (cachedToken) {
          setStatus(copy.opening);
          showPicker(cachedToken.accessToken);
        } else {
          setStatus(copy.accessRequired);
          setReady(true);
        }
      })
      .catch((caught) => {
        if (!active) return;
        const message = caught instanceof Error && caught.message === 'DRIVE_PICKER_TIMEOUT' ? copy.timeout
          : caught instanceof Error && caught.message === 'DRIVE_SCRIPTS_FAILED' ? copy.scriptsFailed
          : caught instanceof Error ? caught.message : copy.openFailed;
        setError(message);
      });
    return () => { active = false; };
  }, [locale, pickerTitle]);

  const authorize = () => {
    setError('');
    setStatus(copy.connecting);
    tokenClientRef.current?.requestAccessToken({ login_hint: configRef.current?.email });
  };

  return <div className="drive-picker-launch" role="status">
    {error ? <><p className="form-error">{error}</p><button type="button" className="secondary-button" onClick={onClose}>{copy.close}</button></> : ready ? <><FolderSearch /><strong>{status}</strong><button type="button" className="primary-button" onClick={authorize}>{copy.connect}</button><small>{copy.tokenHint}</small></> : <><LoaderCircle className="picker-spinner" /><strong>{status}</strong><small>{copy.loading}</small></>}
    <a href="https://drive.google.com" target="_blank" rel="noreferrer"><ExternalLink /> {copy.openDrive}</a>
  </div>;
}
