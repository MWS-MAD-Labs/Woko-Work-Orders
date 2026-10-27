import { pathToFileURL } from 'node:url';
import '../config.js';
import {
  CentralPermissionError,
  checkFailed,
  checkPermissions,
  publishPermissions,
  type CentralTarget,
  type PermissionCheck,
} from '../permissions-sync.js';

const usage = `Usage:
  npm run permissions:check -- [--allow-removals] [--soft] [--retries N] [--wait SECONDS]
  npm run permissions:sync  -- [--check] [--confirm-removals] [--allow-removals] [--soft] [--retries N] [--wait SECONDS]

Needs CENTRAL_API_BASE_URL and CENTRAL_API_TOKEN (CENTRAL_APPLICATION_ID is "woko" unless set).`;

export interface PermissionCliArguments {
  mode: 'check' | 'sync';
  confirmRemovals: boolean;
  allowRemovals: boolean;
  soft: boolean;
  retries: number;
  waitMs: number;
}

export function parsePermissionCliArguments(argv: string[], command: 'check' | 'sync'): PermissionCliArguments {
  const parsed: PermissionCliArguments = { mode: command, confirmRemovals: false, allowRemovals: false, soft: false, retries: 0, waitMs: 5000 };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--check') parsed.mode = 'check';
    else if (flag === '--confirm-removals') parsed.confirmRemovals = true;
    else if (flag === '--allow-removals') parsed.allowRemovals = true;
    else if (flag === '--soft') parsed.soft = true;
    else if (flag === '--retries' || flag === '--wait') {
      const value = argv[index + 1];
      if (value === undefined || !/^\d+$/.test(value)) throw new Error(`${flag} needs a whole number.\n${usage}`);
      index += 1;
      if (flag === '--retries') parsed.retries = Number(value);
      else parsed.waitMs = Number(value) * 1000;
    } else throw new Error(`Unknown option ${flag}.\n${usage}`);
  }
  if (command === 'check' && (parsed.confirmRemovals)) throw new Error(`--confirm-removals is for permissions:sync.\n${usage}`);
  return parsed;
}

export function describeCheck(check: PermissionCheck): string[] {
  const lines: string[] = [];
  if (check.notRegistered.length) lines.push(`Would add: ${check.notRegistered.join(', ')}`);
  if (check.wouldDrop.length) lines.push(`Would drop: ${check.wouldDrop.join(', ')}`);
  if (check.unknownToCode.length) lines.push(`Roles in Central carry permissions the code does not know: ${check.unknownToCode.join(', ')}`);
  if (check.requiresDiffer.length) lines.push(`Needs differ from Central: ${check.requiresDiffer.join(', ')}`);
  return lines.length ? lines : ['The code and Central agree.'];
}

type Output = Pick<Console, 'log' | 'warn' | 'error'>;

export interface PermissionCliDependencies {
  target?: CentralTarget;
  output?: Output;
  sleep?: (ms: number) => Promise<void>;
}

function targetFromEnvironment(): CentralTarget {
  const baseUrl = process.env.CENTRAL_API_BASE_URL?.trim();
  const token = process.env.CENTRAL_API_TOKEN?.trim();
  if (!baseUrl || !token) throw new Error(`CENTRAL_API_BASE_URL and CENTRAL_API_TOKEN are required.\n${usage}`);
  return { baseUrl, token, applicationId: process.env.CENTRAL_APPLICATION_ID?.trim() || 'woko' };
}

// Returns the exit code. A network failure or a 5xx is retried; a refusal from Central is not.
export async function runPermissionCli(argv: string[], command: 'check' | 'sync', dependencies: PermissionCliDependencies = {}): Promise<number> {
  const output = dependencies.output ?? console;
  const sleep = dependencies.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let args: PermissionCliArguments;
  let target: CentralTarget;
  try {
    args = parsePermissionCliArguments(argv, command);
    target = dependencies.target ?? targetFromEnvironment();
  } catch (error) {
    output.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  for (let attempt = 0; ; attempt += 1) {
    try {
      if (args.mode === 'sync') {
        const result = await publishPermissions(target, { confirmRemovals: args.confirmRemovals });
        output.log(`Published ${result.total} permissions to ${target.applicationId}: ${result.added} added, ${result.deprecated.length} dropped.`);
        if (result.legacy_keys.length) output.warn(`Still in an old format: ${result.legacy_keys.join(', ')}`);
        for (const role of result.affected_roles) output.warn(`Role ${role.role} still carries dropped permissions: ${role.permissions.join(', ')}`);
        return 0;
      }
      const check = await checkPermissions(target);
      for (const line of describeCheck(check)) output.log(line);
      return checkFailed(check, { allowRemovals: args.allowRemovals }) && !args.soft ? 1 : 0;
    } catch (error) {
      const retryable = !(error instanceof CentralPermissionError) || error.status >= 500;
      if (retryable && attempt < args.retries) {
        output.warn(`Central did not answer (${error instanceof Error ? error.message : 'error'}). Trying again in ${args.waitMs / 1000}s.`);
        await sleep(args.waitMs);
        continue;
      }
      output.error(error instanceof CentralPermissionError ? `Central refused: ${error.message}` : `Could not reach Central: ${error instanceof Error ? error.message : String(error)}`);
      return args.soft ? 0 : 1;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2] === 'check' ? 'check' : 'sync';
  process.exit(await runPermissionCli(process.argv.slice(3), command));
}
