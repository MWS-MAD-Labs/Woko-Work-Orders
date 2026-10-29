import { useEffect, useState } from 'react';
import { api } from './api';

const BODY_CLASS = 'has-env-banner';

// On a test stack only: a strip at the top that points to the real Woko. The API answers with an address only where
// PRODUCTION_URL is set, so the real one shows nothing.
export function EnvironmentBanner() {
  const [productionUrl, setProductionUrl] = useState<string | null>(null);
  const id = (localStorage.getItem('woko-locale') || 'id') === 'id';

  useEffect(() => {
    let active = true;
    api<{ production_url: string | null }>('/public-config')
      .then((config) => { if (active) setProductionUrl(config.production_url); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    document.body.classList.toggle(BODY_CLASS, Boolean(productionUrl));
    return () => document.body.classList.remove(BODY_CLASS);
  }, [productionUrl]);

  if (!productionUrl) return null;
  return (
    <div className="env-banner" role="note">
      {id ? 'Ini versi uji coba Woko. Perubahan di sini tidak dipakai. Untuk pekerjaan sebenarnya, buka ' : 'This is a test version of Woko. Changes here do not count. For real work, use '}
      <a href={productionUrl}>{productionUrl.replace(/^https?:\/\//, '')}</a>.
    </div>
  );
}
