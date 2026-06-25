import { describe, expect, it } from 'vitest';

import { bearerToken, isAuthorized, secretsMatch } from './auth.ts';

describe('secretsMatch', () => {
  it('is true only for an exact match', () => {
    expect(secretsMatch('hunter2', 'hunter2')).toBe(true);
    expect(secretsMatch('hunter2', 'hunter3')).toBe(false);
    expect(secretsMatch('hunter2', 'hunter2x')).toBe(false); // length differs
    expect(secretsMatch('', '')).toBe(true);
    expect(secretsMatch('x', '')).toBe(false);
  });
});

describe('bearerToken', () => {
  it('extracts the token from an Authorization header', () => {
    expect(bearerToken('Bearer abc.def')).toBe('abc.def');
    expect(bearerToken('bearer abc')).toBe('abc'); // case-insensitive scheme
    expect(bearerToken('  Bearer   spaced  ')).toBe('spaced');
  });

  it('returns empty string when absent or malformed', () => {
    expect(bearerToken(null)).toBe('');
    expect(bearerToken(undefined)).toBe('');
    expect(bearerToken('')).toBe('');
    expect(bearerToken('Basic abc')).toBe('');
  });
});

describe('isAuthorized', () => {
  const secret = 'a-long-random-shared-secret';

  it('accepts the correct bearer secret', () => {
    expect(isAuthorized(`Bearer ${secret}`, secret)).toBe(true);
  });

  it('rejects a wrong, missing, or non-bearer secret', () => {
    expect(isAuthorized('Bearer wrong', secret)).toBe(false);
    expect(isAuthorized(null, secret)).toBe(false);
    expect(isAuthorized(secret, secret)).toBe(false); // missing "Bearer "
  });
});
