/** Immutable references only. File bytes belong to the private server request store. */
export const SOURCE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain', 'text/markdown'] as const;
export type SourceMediaType = typeof SOURCE_MEDIA_TYPES[number];
export const MAX_SOURCE_BYTES = 6 * 1024 * 1024;
export const MAX_REQUEST_SOURCE_BYTES = 12 * 1024 * 1024;
export const MAX_REQUEST_SOURCES = 4;
export interface RequestSource {
  id: string;
  name: string;
  mediaType: SourceMediaType;
  byteLength: number;
  sha256: string;
}
export type AuthoringScope = 'floor-plan-reconstruction';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function sourceMediaType(value: unknown): SourceMediaType {
  switch (value) {
    case 'image/png': case 'image/jpeg': case 'image/webp': case 'application/pdf': case 'text/plain': case 'text/markdown': return value;
    default: throw new Error('Use PNG, JPEG, WebP, PDF, plain text or Markdown files.');
  }
}
export function sourceName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 160 || /[\u0000-\u001f\u007f/\\]/.test(value)) throw new Error('Source filenames must contain 1 to 160 readable characters without paths.');
  return value.trim();
}
export function parseRequestSources(value: unknown): RequestSource[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_REQUEST_SOURCES) throw new Error('Attach between one and four source files.');
  const items = value.map((item: unknown): RequestSource => {
    if (!record(item) || Object.keys(item).length !== 5 || !['id', 'name', 'mediaType', 'byteLength', 'sha256'].every((key) => Object.hasOwn(item, key))
        || typeof item.id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(item.id)
        || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)
        || typeof item.byteLength !== 'number' || !Number.isSafeInteger(item.byteLength) || item.byteLength < 1 || item.byteLength > MAX_SOURCE_BYTES) throw new Error('Invalid immutable request source reference.');
    return { id: item.id, name: sourceName(item.name), mediaType: sourceMediaType(item.mediaType), byteLength: item.byteLength, sha256: item.sha256 };
  });
  if (new Set(items.map((item) => item.id)).size !== items.length || items.reduce((sum, item) => sum + item.byteLength, 0) > MAX_REQUEST_SOURCE_BYTES) throw new Error('Request sources must be unique and total at most 12 MiB.');
  return items;
}
export function parseAuthoringScope(value: unknown): AuthoringScope {
  if (value !== 'floor-plan-reconstruction') throw new Error('Invalid authoring scope.');
  return value;
}
