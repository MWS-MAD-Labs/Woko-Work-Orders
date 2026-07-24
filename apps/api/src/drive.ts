import { Readable } from 'node:stream';
import { google, type drive_v3 } from 'googleapis';
import { config } from './config.js';
import { validateLinkedDriveFile } from './evidence.js';

export const driveSubfolders = {
  INITIAL: '01 Initial Evidence',
  PROGRESS: '02 Progress Evidence',
  PROPOSAL: '03 Proposals',
  COMPLETION: '04 Completion Evidence',
  APPROVALS: '05 Approvals',
  OTHER: '06 Other Documents',
} as const;

export type DriveSubfolderKey = keyof typeof driveSubfolders;
export type DriveSubfolderMap = Record<DriveSubfolderKey, string>;

let driveClient: drive_v3.Drive | undefined;
let driveAuth: InstanceType<typeof google.auth.GoogleAuth> | undefined;

function getDriveAuth() {
  if (!config.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS is not configured.');
  }
  driveAuth ??= new google.auth.GoogleAuth({
    keyFile: config.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return driveAuth;
}

function getDrive(): drive_v3.Drive {
  driveClient ??= google.drive({ version: 'v3', auth: getDriveAuth() });
  return driveClient;
}

async function getDriveWorkerEmail(): Promise<string> {
  const credentials = await getDriveAuth().getCredentials();
  if (!credentials.client_email) throw new Error('DRIVE_WORKER_EMAIL_UNAVAILABLE');
  return credentials.client_email;
}

function escapeDriveQuery(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

async function findChildFolder(parentId: string, name: string): Promise<string | undefined> {
  const response = await getDrive().files.list({
    q: `'${escapeDriveQuery(parentId)}' in parents and name = '${escapeDriveQuery(name)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id)',
    pageSize: 1,
    corpora: 'drive',
    driveId: config.GOOGLE_SHARED_DRIVE_ID,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });
  return response.data.files?.[0]?.id ?? undefined;
}

async function ensureFolder(parentId: string, name: string): Promise<string> {
  const existingId = await findChildFolder(parentId, name);
  if (existingId) return existingId;
  const response = await getDrive().files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
    supportsAllDrives: true,
  });
  if (!response.data.id) throw new Error(`Google Drive did not return an ID for folder ${name}.`);
  return response.data.id;
}

export async function provisionWorkOrderFolder(number: string, title: string): Promise<{ folderId: string; folderUrl: string; subfolders: DriveSubfolderMap }> {
  const safeTitle = title.replaceAll(/[\\/:*?"<>|]/g, '-').trim().slice(0, 120);
  const folderName = `${number} - ${safeTitle}`;
  const folderId = await ensureFolder(config.GOOGLE_WORK_ORDERS_ROOT_FOLDER_ID, folderName);
  const entries = await Promise.all(Object.entries(driveSubfolders).map(async ([key, name]) => [key, await ensureFolder(folderId, name)] as const));
  return {
    folderId,
    folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
    subfolders: Object.fromEntries(entries) as DriveSubfolderMap,
  };
}

export async function createDriveFolderPermission(folderId: string, email: string): Promise<string> {
  try {
    const response = await getDrive().permissions.create({
      fileId: folderId,
      supportsAllDrives: true,
      sendNotificationEmail: false,
      requestBody: { type: 'user', role: 'reader', emailAddress: email },
      fields: 'id',
    });
    if (!response.data.id) throw new Error('DRIVE_PERMISSION_ID_MISSING');
    return response.data.id;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/sharing|permission|policy|domain/i.test(message)) throw new Error('DRIVE_FOLDER_SHARING_NOT_ALLOWED');
    throw new Error('DRIVE_FOLDER_ACCESS_PENDING');
  }
}

export async function deleteDriveFolderPermission(folderId: string, permissionId: string): Promise<void> {
  try {
    await getDrive().permissions.delete({ fileId: folderId, permissionId, supportsAllDrives: true });
  } catch (error) {
    const status = typeof error === 'object' && error !== null && 'code' in error ? Number(error.code) : undefined;
    if (status !== 404) throw new Error('DRIVE_FOLDER_PERMISSION_REMOVAL_PENDING');
  }
}

export async function deleteDriveFile(fileId: string): Promise<void> {
  try {
    await getDrive().files.delete({ fileId, supportsAllDrives: true });
  } catch (deleteError) {
    try {
      await getDrive().files.update({ fileId, supportsAllDrives: true, requestBody: { trashed: true }, fields: 'id,trashed' });
    } catch (trashError) {
      const status = typeof trashError === 'object' && trashError !== null && 'code' in trashError ? Number(trashError.code) : undefined;
      if (status !== 404) throw deleteError;
    }
  }
}

export async function uploadDriveFile(input: { folderId: string; fileName: string; mimeType: string; buffer: Buffer }): Promise<{ id: string; webViewLink: string }> {
  const response = await getDrive().files.create({
    requestBody: { name: input.fileName, parents: [input.folderId] },
    media: { mimeType: input.mimeType, body: Readable.from(input.buffer) },
    fields: 'id,webViewLink',
    supportsAllDrives: true,
  });
  if (!response.data.id) throw new Error('Google Drive did not return an uploaded file ID.');
  return { id: response.data.id, webViewLink: response.data.webViewLink ?? `https://drive.google.com/file/d/${response.data.id}/view` };
}

export function extractDriveFileId(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('drive.google.com') && !parsed.hostname.endsWith('docs.google.com')) return undefined;
    const pathMatch = parsed.pathname.match(/\/d\/([a-zA-Z0-9_-]+)/) ?? parsed.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    return pathMatch?.[1] ?? parsed.searchParams.get('id') ?? undefined;
  } catch {
    return undefined;
  }
}

export interface UserDriveShortcut {
  id: string;
  sourceId: string;
  createdSourcePermissionIds: string[];
  upgradedSourcePermissionIds: string[];
  name: string;
  mimeType: string;
  size: number | null;
  webViewLink: string;
  mode: 'SHORTCUT';
}

function getUserDrive(accessToken: string) {
  const auth = new google.auth.OAuth2(config.GOOGLE_OAUTH_CLIENT_ID, config.GOOGLE_OAUTH_CLIENT_SECRET);
  auth.setCredentials({ access_token: accessToken });
  return { drive: google.drive({ version: 'v3', auth }), auth };
}

export async function createUserDriveShortcut(input: { accessToken: string; expectedEmail: string; sourceFileId: string; folderId: string; participantEmails: string[] }): Promise<UserDriveShortcut> {
  const { drive, auth } = getUserDrive(input.accessToken);
  let identity;
  try { identity = await google.oauth2({ version: 'v2', auth }).userinfo.get(); }
  catch { throw new Error('GOOGLE_DRIVE_AUTHORIZATION_FAILED'); }
  if (!identity.data.email || identity.data.email.toLowerCase() !== input.expectedEmail.toLowerCase()) throw new Error('GOOGLE_ACCOUNT_MISMATCH');

  let metadata;
  try {
    metadata = await drive.files.get({
      fileId: input.sourceFileId,
      fields: 'id,name,mimeType,size,trashed',
      supportsAllDrives: true,
    });
  } catch { throw new Error('DRIVE_FILE_UNAVAILABLE'); }
  if (metadata.data.trashed || !metadata.data.id || !metadata.data.name || !metadata.data.mimeType) throw new Error('DRIVE_FILE_UNAVAILABLE');
  if (metadata.data.mimeType === 'application/vnd.google-apps.folder') throw new Error('DRIVE_FOLDER_NOT_SUPPORTED');
  validateLinkedDriveFile({ fileName: metadata.data.name, mimeType: metadata.data.mimeType, size: metadata.data.size ? Number(metadata.data.size) : null });

  const workerEmail = (await getDriveWorkerEmail()).toLowerCase();
  const participantEmails = [...new Set(input.participantEmails.map((email) => email.toLowerCase()))]
    .filter((email) => email !== input.expectedEmail.toLowerCase() && email !== workerEmail);
  const createdSourcePermissionIds: string[] = [];
  const upgradedSourcePermissionIds: string[] = [];
  try {
    const permissions = await drive.permissions.list({
      fileId: metadata.data.id,
      fields: 'permissions(id,type,emailAddress,role)',
      supportsAllDrives: true,
    });
    const existingByEmail = new Map(permissions.data.permissions
      ?.filter((permission) => permission.type === 'user' && permission.emailAddress)
      .map((permission) => [permission.emailAddress!.toLowerCase(), permission]) ?? []);
    const workerPermission = existingByEmail.get(workerEmail);
    if (!workerPermission) {
      const permission = await drive.permissions.create({
        fileId: metadata.data.id,
        supportsAllDrives: true,
        sendNotificationEmail: false,
        requestBody: { type: 'user', role: 'writer', emailAddress: workerEmail },
        fields: 'id',
      });
      if (permission.data.id) createdSourcePermissionIds.push(permission.data.id);
    } else if (workerPermission.id && workerPermission.role === 'reader') {
      await drive.permissions.update({ fileId: metadata.data.id, permissionId: workerPermission.id, supportsAllDrives: true, requestBody: { role: 'writer' } });
      upgradedSourcePermissionIds.push(workerPermission.id);
    }
    for (const emailAddress of participantEmails) {
      const existingPermission = existingByEmail.get(emailAddress);
      if (existingPermission?.id && existingPermission.role === 'reader') {
        await drive.permissions.update({ fileId: metadata.data.id, permissionId: existingPermission.id, supportsAllDrives: true, requestBody: { role: 'writer' } });
        upgradedSourcePermissionIds.push(existingPermission.id);
        continue;
      }
      if (existingPermission) continue;
      const permission = await drive.permissions.create({
        fileId: metadata.data.id,
        supportsAllDrives: true,
        sendNotificationEmail: false,
        requestBody: { type: 'user', role: 'writer', emailAddress },
        fields: 'id',
      });
      if (permission.data.id) createdSourcePermissionIds.push(permission.data.id);
    }
  } catch {
    await Promise.all(createdSourcePermissionIds.map((permissionId) => drive.permissions.delete({ fileId: metadata.data.id!, permissionId, supportsAllDrives: true }).catch(() => undefined)));
    await Promise.all(upgradedSourcePermissionIds.map((permissionId) => drive.permissions.update({ fileId: metadata.data.id!, permissionId, supportsAllDrives: true, requestBody: { role: 'reader' } }).catch(() => undefined)));
    throw new Error('DRIVE_FILE_SHARE_FAILED');
  }

  try {
    const shortcut = await getDrive().files.create({
      requestBody: {
        name: metadata.data.name,
        mimeType: 'application/vnd.google-apps.shortcut',
        parents: [input.folderId],
        shortcutDetails: { targetId: metadata.data.id },
      },
      fields: 'id,name,webViewLink',
      supportsAllDrives: true,
    });
    if (!shortcut.data.id) throw new Error('DRIVE_SHORTCUT_FAILED');
    return {
      id: shortcut.data.id,
      sourceId: metadata.data.id,
      createdSourcePermissionIds,
      upgradedSourcePermissionIds,
      name: shortcut.data.name ?? metadata.data.name,
      mimeType: metadata.data.mimeType,
      size: metadata.data.size ? Number(metadata.data.size) : null,
      webViewLink: `https://drive.google.com/open?id=${metadata.data.id}`,
      mode: 'SHORTCUT',
    };
  } catch {
    await Promise.all(createdSourcePermissionIds.map((permissionId) => drive.permissions.delete({ fileId: metadata.data.id!, permissionId, supportsAllDrives: true }).catch(() => undefined)));
    await Promise.all(upgradedSourcePermissionIds.map((permissionId) => drive.permissions.update({ fileId: metadata.data.id!, permissionId, supportsAllDrives: true, requestBody: { role: 'reader' } }).catch(() => undefined)));
    throw new Error('DRIVE_SHORTCUT_FAILED');
  }
}

export async function rollbackUserDriveShortcut(accessToken: string, shortcut: UserDriveShortcut): Promise<void> {
  await deleteDriveFile(shortcut.id).catch(() => undefined);
  if (!shortcut.createdSourcePermissionIds.length && !shortcut.upgradedSourcePermissionIds.length) return;
  const { drive } = getUserDrive(accessToken);
  await Promise.all(shortcut.createdSourcePermissionIds.map((permissionId) => drive.permissions.delete({ fileId: shortcut.sourceId, permissionId, supportsAllDrives: true }).catch(() => undefined)));
  await Promise.all(shortcut.upgradedSourcePermissionIds.map((permissionId) => drive.permissions.update({ fileId: shortcut.sourceId, permissionId, supportsAllDrives: true, requestBody: { role: 'reader' } }).catch(() => undefined)));
}

export async function shareDriveFileWithEditors(fileId: string, participantEmails: string[]): Promise<void> {
  const drive = getDrive();
  const editorEmails = [...new Set(participantEmails.map((email) => email.toLowerCase()))];
  const permissions = await drive.permissions.list({ fileId, fields: 'permissions(id,type,emailAddress,role)', supportsAllDrives: true });
  const existingByEmail = new Map(permissions.data.permissions
    ?.filter((permission) => permission.type === 'user' && permission.emailAddress)
    .map((permission) => [permission.emailAddress!.toLowerCase(), permission]) ?? []);
  try {
    for (const emailAddress of editorEmails) {
      const existingPermission = existingByEmail.get(emailAddress);
      if (existingPermission?.id && existingPermission.role === 'reader') {
        await drive.permissions.update({ fileId, permissionId: existingPermission.id, supportsAllDrives: true, requestBody: { role: 'writer' } });
        continue;
      }
      if (existingPermission) continue;
      await drive.permissions.create({
        fileId,
        supportsAllDrives: true,
        sendNotificationEmail: false,
        requestBody: { type: 'user', role: 'writer', emailAddress },
        fields: 'id',
      });
    }
  } catch {
    throw new Error('DRIVE_FILE_SHARE_FAILED');
  }
}

export async function copyExistingDriveFile(input: { sourceFileId: string; folderId: string }): Promise<{ id: string; sourceId: string; name: string; mimeType: string; size: number | null; webViewLink: string }> {
  const metadata = await getDrive().files.get({
    fileId: input.sourceFileId,
    fields: 'id,name,mimeType,size,trashed',
    supportsAllDrives: true,
  });
  if (metadata.data.trashed || !metadata.data.id || !metadata.data.name || !metadata.data.mimeType) throw new Error('The selected Drive file is not available.');
  if (metadata.data.mimeType === 'application/vnd.google-apps.folder') throw new Error('Drive folders cannot be attached as evidence.');
  const copied = await getDrive().files.copy({
    fileId: metadata.data.id,
    requestBody: { name: metadata.data.name, parents: [input.folderId] },
    fields: 'id,name,mimeType,size,webViewLink',
    supportsAllDrives: true,
  });
  if (!copied.data.id) throw new Error('Google Drive did not return a copied file ID.');
  return {
    id: copied.data.id,
    sourceId: metadata.data.id,
    name: copied.data.name ?? metadata.data.name,
    mimeType: copied.data.mimeType ?? metadata.data.mimeType,
    size: copied.data.size ? Number(copied.data.size) : metadata.data.size ? Number(metadata.data.size) : null,
    webViewLink: copied.data.webViewLink ?? `https://drive.google.com/open?id=${copied.data.id}`,
  };
}

export async function linkExistingDriveFile(input: { sourceFileId: string; folderId: string }): Promise<{ id: string; targetId: string; name: string; mimeType: string; size: number | null; webViewLink: string }> {
  const metadata = await getDrive().files.get({
    fileId: input.sourceFileId,
    fields: 'id,name,mimeType,size,webViewLink,trashed',
    supportsAllDrives: true,
  });
  if (metadata.data.trashed || !metadata.data.id || !metadata.data.name || !metadata.data.mimeType) throw new Error('The linked Drive file is not available.');
  if (metadata.data.mimeType === 'application/vnd.google-apps.folder') throw new Error('Drive folders cannot be used as file evidence.');
  const copied = await getDrive().files.copy({
    fileId: metadata.data.id,
    requestBody: { name: metadata.data.name, parents: [input.folderId] },
    fields: 'id,name,mimeType,size,webViewLink',
    supportsAllDrives: true,
  });
  if (!copied.data.id) throw new Error('Google Drive did not return a copied file ID.');
  return {
    id: copied.data.id,
    targetId: metadata.data.id,
    name: copied.data.name ?? metadata.data.name,
    mimeType: copied.data.mimeType ?? metadata.data.mimeType,
    size: copied.data.size ? Number(copied.data.size) : metadata.data.size ? Number(metadata.data.size) : null,
    webViewLink: copied.data.webViewLink ?? `https://drive.google.com/open?id=${copied.data.id}`,
  };
}
