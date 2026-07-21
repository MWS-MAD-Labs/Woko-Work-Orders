import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { extractDriveFileId } from './drive.js';
import { prepareEvidenceUpload, validateEvidenceMetadata, validateLinkedDriveFile } from './evidence.js';

describe('evidence validation', () => {
  it('rejects extension and MIME mismatches', () => {
    expect(() => validateEvidenceMetadata({ fileName: 'photo.jpg', declaredMimeType: 'application/pdf', size: 100 })).toThrow('MIME_EXTENSION_MISMATCH');
  });

  it('rejects oversized files', () => {
    expect(() => validateEvidenceMetadata({ fileName: 'photo.jpg', declaredMimeType: 'image/jpeg', size: 16 * 1024 * 1024 })).toThrow('FILE_SIZE_NOT_ALLOWED');
  });

  it('accepts Google Workspace files when linked from Drive', () => {
    expect(() => validateLinkedDriveFile({ fileName: 'Vendor proposal', mimeType: 'application/vnd.google-apps.document', size: null })).not.toThrow();
  });

  it('auto-orients and compresses image evidence to JPEG', async () => {
    const input = await sharp({ create: { width: 3200, height: 1800, channels: 3, background: '#886655' } }).jpeg({ quality: 100 }).toBuffer();
    const prepared = await prepareEvidenceUpload({ fileName: 'mobile-photo.jpg', mimeType: 'image/jpeg', buffer: input });
    const metadata = await sharp(prepared.buffer).metadata();
    expect(prepared.fileName).toBe('mobile-photo.jpg');
    expect(prepared.mimeType).toBe('image/jpeg');
    expect(metadata.width).toBeLessThanOrEqual(2560);
    expect(metadata.height).toBeLessThanOrEqual(2560);
    expect(prepared.buffer.length).toBeLessThan(input.length);
  });
});

describe('Google Drive links', () => {
  it('extracts file IDs from Drive and Docs links', () => {
    expect(extractDriveFileId('https://drive.google.com/file/d/abc_DEF-123/view')).toBe('abc_DEF-123');
    expect(extractDriveFileId('https://docs.google.com/document/d/document_123/edit')).toBe('document_123');
    expect(extractDriveFileId('https://example.com/file/d/abc/view')).toBeUndefined();
  });
});
