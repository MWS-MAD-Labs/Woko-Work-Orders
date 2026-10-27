import { describe, expect, it } from 'vitest';
import { permissionManifest } from '@woko/domain';
import { centralOrigin, checkFailed, checkPermissions, comparePermissionManifest, publishPermissions } from './permissions-sync.js';
import { describeCheck, parsePermissionCliArguments, runPermissionCli } from './scripts/permissions-cli.js';
import { renderRolePresets, rolePresetsPath } from './scripts/role-presets-cli.js';
import { readFileSync } from 'node:fs';

const registeredFromCode = permissionManifest.map((entry) => ({ key: entry.key as string, requires: [...(entry.requires ?? [])], deprecated: false }));

function fakeCentral(handler: (url: URL, init: RequestInit) => unknown, status = 200) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fetchImpl = (async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return new Response(JSON.stringify(handler(url, init)), { status });
  }) as typeof fetch;
  return { calls, target: { baseUrl: 'https://central.example.org/api/internal/', token: 'secret-token', applicationId: 'woko', fetchImpl } };
}

describe('comparing the code with Central', () => {
  it('agrees when Central has exactly the code', () => {
    const check = comparePermissionManifest(permissionManifest, registeredFromCode, []);
    expect(check).toEqual({ notRegistered: [], wouldDrop: [], unknownToCode: [], requiresDiffer: [] });
    expect(checkFailed(check)).toBe(false);
    expect(describeCheck(check)).toEqual(['The code and Central agree.']);
  });

  it('sees what a deploy would add and drop, what roles carry that the code lacks, and different needs', () => {
    const registered = [...registeredFromCode.filter((row) => row.key !== 'users.read').map((row) => (row.key === 'users.manage' ? { ...row, requires: [] } : row)), { key: 'old.thing', requires: [], deprecated: false }];
    const check = comparePermissionManifest(permissionManifest, registered, ['old.thing', 'work-order.create']);
    expect(check.notRegistered).toContain('users.read');
    expect(check.wouldDrop).toEqual(['old.thing']);
    expect(check.unknownToCode).toEqual(['old.thing']);
    expect(check.requiresDiffer).toContain('users.manage');
    expect(checkFailed(check)).toBe(true);
    expect(checkFailed({ ...check, unknownToCode: [], requiresDiffer: [] }, { allowRemovals: true })).toBe(false);
  });

  it('ignores a dropped permission when it looks at what is registered', () => {
    const check = comparePermissionManifest(permissionManifest, registeredFromCode.map((row) => (row.key === 'users.read' ? { ...row, deprecated: true } : row)), []);
    expect(check.notRegistered).toEqual(['users.read']);
  });
});

describe('talking to Central', () => {
  it('accepts the address with or without /api/internal', () => {
    expect(centralOrigin('https://central.example.org/api/internal/')).toBe('https://central.example.org');
    expect(centralOrigin(' https://central.example.org// ')).toBe('https://central.example.org');
  });

  it('publishes the whole manifest with the token, and asks to confirm removals only when told', async () => {
    const { calls, target } = fakeCentral(() => ({ data: { total: 28, added: 28, deprecated: [], affected_roles: [], legacy_keys: [] } }));
    await publishPermissions(target);
    await publishPermissions(target, { confirmRemovals: true });
    expect(calls[0]!.url.toString()).toBe('https://central.example.org/api/internal/application-permissions/woko');
    expect(calls[0]!.init.method).toBe('PUT');
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe('Bearer secret-token');
    const first = JSON.parse(String(calls[0]!.init.body));
    expect(first.permissions.map((entry: { key: string }) => entry.key)).toEqual(permissionManifest.map((entry) => entry.key));
    expect(first.confirm_removals).toBeUndefined();
    expect(JSON.parse(String(calls[1]!.init.body)).confirm_removals).toBe(true);
  });

  it('checks by reading what is registered and what roles carry', async () => {
    const { calls, target } = fakeCentral((url) => ({ data: url.pathname.endsWith('/usage') ? [] : registeredFromCode }));
    expect(await checkPermissions(target)).toEqual({ notRegistered: [], wouldDrop: [], unknownToCode: [], requiresDiffer: [] });
    expect(calls.map((call) => call.url.pathname).sort()).toEqual(['/api/internal/application-permissions/woko', '/api/internal/application-permissions/woko/usage']);
  });
});

describe('the permissions command', () => {
  const quiet = () => {
    const lines: string[] = [];
    return { lines, output: { log: (m: string) => lines.push(m), warn: (m: string) => lines.push(m), error: (m: string) => lines.push(m) } as Pick<Console, 'log' | 'warn' | 'error'> };
  };

  it('reads the options and refuses unknown ones', () => {
    expect(parsePermissionCliArguments(['--confirm-removals', '--retries', '2', '--wait', '3'], 'sync')).toMatchObject({ mode: 'sync', confirmRemovals: true, retries: 2, waitMs: 3000 });
    expect(parsePermissionCliArguments(['--check'], 'sync').mode).toBe('check');
    expect(() => parsePermissionCliArguments(['--nope'], 'sync')).toThrow(/Unknown option/);
    expect(() => parsePermissionCliArguments(['--retries'], 'sync')).toThrow(/whole number/);
    expect(() => parsePermissionCliArguments(['--confirm-removals'], 'check')).toThrow(/permissions:sync/);
  });

  it('publishes, and warns about old keys and roles that still carry dropped permissions', async () => {
    const { target } = fakeCentral(() => ({ data: { total: 28, added: 1, deprecated: ['a.b'], affected_roles: [{ role: 'WORKER', permissions: ['a.b'] }], legacy_keys: ['x:y'] } }));
    const { lines, output } = quiet();
    expect(await runPermissionCli([], 'sync', { target, output })).toBe(0);
    expect(lines.join('\n')).toContain('Published 28 permissions to woko: 1 added, 1 dropped.');
    expect(lines.join('\n')).toContain('Still in an old format: x:y');
    expect(lines.join('\n')).toContain('Role WORKER still carries dropped permissions: a.b');
  });

  it('fails a check that disagrees, passes it with --soft, and never prints the token', async () => {
    const { target } = fakeCentral((url) => ({ data: url.pathname.endsWith('/usage') ? ['mystery.key'] : registeredFromCode }));
    const strict = quiet();
    expect(await runPermissionCli([], 'check', { target, output: strict.output })).toBe(1);
    const soft = quiet();
    expect(await runPermissionCli(['--soft'], 'check', { target, output: soft.output })).toBe(0);
    expect([...strict.lines, ...soft.lines].join('\n')).not.toContain('secret-token');
  });

  it('retries when Central is down, but not when it refuses', async () => {
    let attempts = 0;
    const down = { baseUrl: 'https://central.example.org', token: 't', applicationId: 'woko', fetchImpl: (async () => { attempts += 1; throw new Error('connect ECONNREFUSED'); }) as typeof fetch };
    const waited: number[] = [];
    const { output } = quiet();
    expect(await runPermissionCli(['--retries', '2', '--wait', '1'], 'sync', { target: down, output, sleep: async (ms) => { waited.push(ms); } })).toBe(1);
    expect(attempts).toBe(3);
    expect(waited).toEqual([1000, 1000]);

    let refusals = 0;
    const refused = { baseUrl: 'https://central.example.org', token: 't', applicationId: 'woko', fetchImpl: (async () => { refusals += 1; return new Response(JSON.stringify({ errors: 'New permission "x:y" must be domain.action' }), { status: 400 }); }) as typeof fetch };
    const refusal = quiet();
    expect(await runPermissionCli(['--retries', '2'], 'sync', { target: refused, output: refusal.output, sleep: async () => {} })).toBe(1);
    expect(refusals).toBe(1);
    expect(refusal.lines.join('\n')).toContain('Central refused: New permission "x:y" must be domain.action');
  });
});

describe('role-presets.json', () => {
  it('is what the permission bundles say, so Central creates the roles the code expects', () => {
    expect(readFileSync(rolePresetsPath, 'utf8')).toBe(renderRolePresets());
  });
});
