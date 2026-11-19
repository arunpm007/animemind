import { describe, expect, it } from 'vitest';
import { safeNext } from '@/server/http/safe-redirect';

describe('safeNext — post-sign-in destination', () => {
  it.each([
    ['/', '/'],
    ['/library', '/library'],
    ['/series/attack-on-titan?tab=seasons#s3', '/series/attack-on-titan?tab=seasons#s3'],
    ['/watching/', '/watching/'],
  ])('keeps the on-site path %s', (raw, expected) => {
    expect(safeNext(raw)).toBe(expected);
  });

  it.each([
    // The bypass found in QA: browsers read "\" as "/".
    '/\\evil.example',
    '/\\/evil.example',
    '\\\\evil.example',
    // Protocol-relative and absolute URLs.
    '//evil.example',
    '///evil.example',
    'https://evil.example',
    'http:evil.example',
    // Browsers silently drop tabs and newlines inside URLs.
    '/\t/evil.example',
    '/\n/evil.example',
    '/\r/evil.example',
    // Other schemes and non-paths.
    'javascript:alert(1)',
    'data:text/html,hi',
    'evil.example',
    '',
  ])('refuses %j', (raw) => {
    expect(safeNext(raw)).toBe('/');
  });

  it('handles null and undefined', () => {
    expect(safeNext(null)).toBe('/');
    expect(safeNext(undefined)).toBe('/');
  });
});
