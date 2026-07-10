import { describe, expect, it } from 'vitest';
import { parse } from 'pg-connection-string';
import { normalizeSsl } from '../src/executor/pg.js';

/*
 * Regression: a real user's `openquery connect` crashed with
 * "TypeError: Cannot use 'in' operator to search for 'key' in required" —
 * pg received ssl as a string. Whatever pg-connection-string yields, the
 * executor must hand pg either `false` or an object, never a string/boolean.
 */

describe('SSL config normalization (regression: connect crash on ssl=required)', () => {
  const objectOrFalse = (v: unknown) => v === false || (typeof v === 'object' && v !== null);

  it.each([
    ['require', { rejectUnauthorized: false }],
    ['required', { rejectUnauthorized: false }],
    ['prefer', { rejectUnauthorized: false }],
    ['true', { rejectUnauthorized: false }],
    ['1', { rejectUnauthorized: false }],
  ])('string mode %s becomes a safe value', (mode, expected) => {
    const result = normalizeSsl(mode);
    expect(objectOrFalse(result)).toBe(true);
    expect(result).toEqual(expected);
  });

  it('verify modes keep certificate verification on', () => {
    expect(normalizeSsl('verify-full')).toEqual({});
    expect(normalizeSsl('verify-ca')).toEqual({});
  });

  it('disable/false/absent mean no TLS', () => {
    expect(normalizeSsl('disable')).toBe(false);
    expect(normalizeSsl(false)).toBe(false);
    expect(normalizeSsl(undefined)).toBe(false);
    expect(normalizeSsl(null)).toBe(false);
  });

  it('boolean true (from ssl=true URLs parsed upstream) becomes an object', () => {
    expect(normalizeSsl(true)).toEqual({ rejectUnauthorized: false });
  });

  it('object configs pass through untouched', () => {
    const custom = { rejectUnauthorized: true, ca: 'PEM' };
    expect(normalizeSsl(custom)).toBe(custom);
  });

  it('end-to-end: the crashing URL shapes now yield pg-safe ssl values', () => {
    for (const url of [
      'postgres://u:p@db.example.com:5432/prod?ssl=required',
      'postgres://u:p@db.example.com:5432/prod?sslmode=require',
      'postgres://u:p@db.example.com:5432/prod?ssl=true',
      'postgres://u:p@db.example.com:5432/prod?sslmode=disable',
      'postgres://u:p@db.example.com:5432/prod',
    ]) {
      const normalized = normalizeSsl(parse(url).ssl);
      expect(objectOrFalse(normalized), `unsafe ssl for ${url}`).toBe(true);
    }
  });
});
