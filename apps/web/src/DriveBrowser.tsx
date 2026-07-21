import { useEffect, useRef, useState } from 'react';
import { ExternalLink, FolderSearch, LoaderCircle } from 'lucide-react';
import { api } from './api';

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
  title?: string;
  onClose: () => void;
  onSelect: (file: DriveBrowserItem, accessToken: string) => void;
}

let scriptsPromise: Promise<void> | undefined;

function loadGoogleScripts(): Promise<void> {
  scriptsPromise ??= new Promise((resolve, reject) => {
    let pickerReady = Boolean(window.google?.picker);
    let identityReady = Boolean(window.google?.accounts?.oauth2);
    const timeout = window.setTimeout(() => reject(new Error('Google Picker initialization timed out. Check popup blocking and the browser console.')), 12_000);
    const done = () => {
      if (pickerReady && identityReady) {
        window.clearTimeout(timeout);
        resolve();
      }
    };
    const fail = () => {
      window.clearTimeout(timeout);
      reject(new Error('Google Drive scripts could not be loaded.'));
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

export function DriveBrowser({ title = 'Choose from Google Drive', onClose, onSelect }: DriveBrowserProps) {
  const [status, setStatus] = useState('Preparing Google Drive…');
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
      setError('Google Picker is not ready. Close this panel and try again.');
      return;
    }
    const view = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
      .setOwnedByMe(true)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false);
    const picker = new window.google.picker.PickerBuilder()
      .setTitle(title)
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
    setStatus('Google Picker is open.');
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
          callback: (response: { access_token?: string; error?: string }) => {
            if (!active) return;
            if (response.error || !response.access_token) {
              setError(`Google Drive permission was not granted${response.error ? ` (${response.error})` : ''}.`);
              return;
            }
            showPicker(response.access_token);
          },
          error_callback: (response: { type?: string }) => {
            if (!active) return;
            const message = response.type === 'popup_failed_to_open'
              ? 'The Google authorization popup was blocked. Allow popups for Woko and try again.'
              : response.type === 'popup_closed'
                ? 'The Google authorization window was closed before Drive access completed.'
                : `Google authorization could not be opened (${response.type ?? 'unknown'}). Check that this exact Woko URL is registered as an OAuth JavaScript origin.`;
            setError(message);
          },
        });
        setStatus('Ready to open your Drive');
        setReady(true);
      })
      .catch((caught) => active && setError(caught instanceof Error ? caught.message : 'Google Drive could not be opened.'));
    return () => { active = false; };
  }, [title]);

  const authorize = () => {
    setError('');
    setStatus('Waiting for Google authorization…');
    tokenClientRef.current?.requestAccessToken({ prompt: 'consent', login_hint: configRef.current?.email });
  };

  return <div className="drive-picker-launch" role="status">
    {error ? <><p className="form-error">{error}</p><button type="button" className="secondary-button" onClick={onClose}>Close</button></> : ready ? <><FolderSearch /><strong>{status}</strong><button type="button" className="primary-button" onClick={authorize}>Continue to Google Drive</button><small>Google will open a secure authorization window, followed by the native Drive Picker.</small></> : <><LoaderCircle className="picker-spinner" /><strong>{status}</strong><small>Loading Google Identity Services and Picker…</small></>}
    <a href="https://drive.google.com" target="_blank" rel="noreferrer"><ExternalLink /> Open Google Drive</a>
  </div>;
}
