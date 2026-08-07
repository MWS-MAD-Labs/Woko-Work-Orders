const apiUrl = import.meta.env.VITE_API_URL ?? '/api/v1';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
  }
}

type ApiEnvelope<T, M = unknown> = { data: T; meta?: M };

async function requestEnvelope<T, M = unknown>(path: string, init?: RequestInit): Promise<ApiEnvelope<T, M>> {
  const headers = new Headers(init?.headers);
  if (typeof init?.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.error?.message ?? 'Request failed', response.status, body.error?.code);
  return body as ApiEnvelope<T, M>;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  return (await requestEnvelope<T>(path, init)).data;
}

export async function apiWithMeta<T, M>(path: string, init?: RequestInit): Promise<ApiEnvelope<T, M>> {
  return requestEnvelope<T, M>(path, init);
}

export function apiResourceUrl(path: string): string {
  return `${apiUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

export function authLoginUrl(redirect = '/'): string {
  return `${apiUrl}/auth/login?redirect=${encodeURIComponent(redirect)}`;
}

export function uploadWithProgress<T>(path: string, formData: FormData, onProgress: (percent: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `${apiUrl}${path}`);
    request.withCredentials = true;
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener('load', () => {
      let body: { data?: T; error?: { message?: string; code?: string } } = {};
      try { body = JSON.parse(request.responseText); } catch { /* Use the generic error below. */ }
      if (request.status >= 200 && request.status < 300 && body.data !== undefined) resolve(body.data);
      else reject(new ApiError(body.error?.message ?? 'Upload failed', request.status, body.error?.code));
    });
    request.addEventListener('error', () => reject(new Error('Upload failed')));
    request.send(formData);
  });
}

export function createIdempotencyKey(): string {
  return crypto.randomUUID();
}
