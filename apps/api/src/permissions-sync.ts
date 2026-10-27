import { permissionManifest, type PermissionManifestEntry } from '@woko/domain';

// Sends Woko's permission list to Central and compares it with what Central has (Access Standard AS-4). It talks to
// Central with plain fetch, so the production image needs no extra package.

export interface RegisteredPermission {
  key: string;
  requires: string[];
  deprecated: boolean;
}

export interface PermissionCheck {
  // In the code but not registered (or dropped) in Central, so a deploy would add them.
  notRegistered: string[];
  // Registered and current in Central but gone from the code, so a deploy would drop them.
  wouldDrop: string[];
  // Active roles in Central carry these but the code does not know them.
  unknownToCode: string[];
  // Registered with other needs than the code says.
  requiresDiffer: string[];
}

export interface SyncResult {
  total: number;
  added: number;
  deprecated: string[];
  affected_roles: Array<{ role: string; permissions: string[] }>;
  legacy_keys: string[];
}

export class CentralPermissionError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'CentralPermissionError';
  }
}

export function comparePermissionManifest(code: readonly PermissionManifestEntry[], registered: readonly RegisteredPermission[], usage: readonly string[]): PermissionCheck {
  const inCode = new Set<string>(code.map((entry) => entry.key));
  const current = registered.filter((entry) => !entry.deprecated);
  const same = (left: readonly string[] = [], right: readonly string[] = []) => [...left].sort().join('\n') === [...right].sort().join('\n');
  return {
    notRegistered: code.filter((entry) => !current.some((row) => row.key === entry.key)).map((entry) => entry.key),
    wouldDrop: current.filter((row) => !inCode.has(row.key)).map((row) => row.key),
    unknownToCode: usage.filter((key) => !inCode.has(key)),
    requiresDiffer: code.filter((entry) => {
      const row = current.find((candidate) => candidate.key === entry.key);
      return row !== undefined && !same(entry.requires, row.requires);
    }).map((entry) => entry.key),
  };
}

// Anything that means code and Central disagree in a way someone has to look at. A key not registered yet is expected
// before a deploy, so it does not count.
export function checkFailed(check: PermissionCheck, options: { allowRemovals?: boolean } = {}): boolean {
  return check.unknownToCode.length > 0 || check.requiresDiffer.length > 0 || (!options.allowRemovals && check.wouldDrop.length > 0);
}

export interface CentralTarget {
  baseUrl: string;
  token: string;
  applicationId: string;
  fetchImpl?: typeof fetch;
}

// The address may be given with or without /api/internal.
export function centralOrigin(value: string): string {
  return value.trim().replace(/\/+$/, '').replace(/\/api\/internal$/, '');
}

async function call<T>(target: CentralTarget, method: 'GET' | 'PUT', path: string, body?: unknown): Promise<T> {
  const url = `${centralOrigin(target.baseUrl)}/api/internal/application-permissions/${encodeURIComponent(target.applicationId)}${path}`;
  const response = await (target.fetchImpl ?? fetch)(url, {
    method,
    headers: { authorization: `Bearer ${target.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let parsed: unknown;
  try { parsed = text ? JSON.parse(text) : undefined; } catch { parsed = undefined; }
  if (!response.ok) {
    const failure = parsed as { errors?: unknown; message?: unknown } | undefined;
    throw new CentralPermissionError(response.status, String(failure?.errors ?? failure?.message ?? `Central answered ${response.status}`));
  }
  return (parsed as { data: T }).data;
}

export function publishPermissions(target: CentralTarget, options: { confirmRemovals?: boolean } = {}, manifest: readonly PermissionManifestEntry[] = permissionManifest): Promise<SyncResult> {
  return call<SyncResult>(target, 'PUT', '', { permissions: manifest, ...(options.confirmRemovals ? { confirm_removals: true } : {}) });
}

export async function checkPermissions(target: CentralTarget, manifest: readonly PermissionManifestEntry[] = permissionManifest): Promise<PermissionCheck> {
  const [registered, usage] = await Promise.all([call<RegisteredPermission[]>(target, 'GET', ''), call<string[]>(target, 'GET', '/usage')]);
  return comparePermissionManifest(manifest, registered, usage);
}
