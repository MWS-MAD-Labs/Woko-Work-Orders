import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { evidenceRules } from '@woko/domain';

const extensionMimeTypes: Record<string, readonly string[]> = {
  jpg: ['image/jpeg'], jpeg: ['image/jpeg'], png: ['image/png'], webp: ['image/webp'], heic: ['image/heic', 'image/heif'], heif: ['image/heic', 'image/heif'],
  pdf: ['application/pdf'], doc: ['application/msword'], docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xls: ['application/vnd.ms-excel'], xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
};

export function validateEvidenceMetadata(input: { fileName: string; declaredMimeType: string; detectedMimeType?: string; size: number }): void {
  const extension = path.extname(input.fileName).slice(1).toLowerCase();
  if (!evidenceRules.allowedExtensions.includes(extension as (typeof evidenceRules.allowedExtensions)[number])) throw new Error('FILE_EXTENSION_NOT_ALLOWED');
  if (input.size <= 0 || input.size > evidenceRules.maxFileSizeBytes) throw new Error('FILE_SIZE_NOT_ALLOWED');
  const allowedForExtension = extensionMimeTypes[extension] ?? [];
  if (!evidenceRules.allowedMimeTypes.includes(input.declaredMimeType as (typeof evidenceRules.allowedMimeTypes)[number])) throw new Error('MIME_TYPE_NOT_ALLOWED');
  if (!allowedForExtension.includes(input.declaredMimeType)) throw new Error('MIME_EXTENSION_MISMATCH');
  if (input.detectedMimeType && !allowedForExtension.includes(input.detectedMimeType)) throw new Error('FILE_CONTENT_MISMATCH');
}

export async function prepareEvidenceUpload(input: { fileName: string; mimeType: string; buffer: Buffer }): Promise<{ fileName: string; mimeType: string; buffer: Buffer; originalFileName: string }> {
  const detected = await fileTypeFromBuffer(input.buffer);
  validateEvidenceMetadata({ fileName: input.fileName, declaredMimeType: input.mimeType, detectedMimeType: detected?.mime, size: input.buffer.length });
  if (!input.mimeType.startsWith('image/')) return { ...input, originalFileName: input.fileName };

  const baseName = path.basename(input.fileName, path.extname(input.fileName)).slice(0, 150);
  const buffer = await sharp(input.buffer)
    .autoOrient()
    .resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  return { fileName: `${baseName}.jpg`, mimeType: 'image/jpeg', buffer, originalFileName: input.fileName };
}

const allowedGoogleWorkspaceMimeTypes = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
  'application/vnd.google-apps.drawing',
]);

export function validateLinkedDriveFile(input: { fileName: string; mimeType: string; size: number | null }): void {
  if (allowedGoogleWorkspaceMimeTypes.has(input.mimeType)) return;
  validateEvidenceMetadata({ fileName: input.fileName, declaredMimeType: input.mimeType, size: input.size ?? 1 });
}

export function isCompletionPhoto(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

