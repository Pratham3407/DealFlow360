import { describe, expect, it } from 'vitest';
import { hashPassword, needsRehash, verifyPassword } from '../../src/modules/auth/password';

describe('password hashing', () => {
  it('verifies a correct password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('Correct horse battery staple', hash)).resolves.toBe(false);
    await expect(verifyPassword('', hash)).resolves.toBe(false);
  });

  it('salts each hash, so identical passwords do not collide', async () => {
    const [first, second] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(first).not.toBe(second);
    await expect(verifyPassword('same', first)).resolves.toBe(true);
    await expect(verifyPassword('same', second)).resolves.toBe(true);
  });

  it('encodes its parameters so cost can be raised later', async () => {
    const hash = await hashPassword('whatever');
    const [algorithm, N, r, p, keyLength] = hash.split('$');
    expect(algorithm).toBe('scrypt');
    expect(Number(N)).toBeGreaterThanOrEqual(65_536);
    expect(Number(r)).toBeGreaterThanOrEqual(8);
    expect(Number(p)).toBeGreaterThanOrEqual(1);
    expect(Number(keyLength)).toBe(64);
    expect(needsRehash(hash)).toBe(false);
  });

  it('treats a malformed or truncated stored hash as a failed verification', async () => {
    for (const bad of [
      '',
      'not-a-hash',
      'scrypt$16384$8$1$64$c2FsdA==$aGFzaA==',
      'bcrypt$65536$8$1$64$c2FsdA==$aGFzaA==',
      'scrypt$0$8$1$64$c2FsdA==$aGFzaA==',
    ]) {
      await expect(verifyPassword('anything', bad)).resolves.toBe(false);
    }
  });

  it('flags hashes weaker than current policy for rehashing', () => {
    // Same shape, lower cost - what an old stored credential would look like.
    expect(needsRehash('scrypt$16384$8$1$64$c2FsdA==$aGFzaA==')).toBe(true);
    expect(needsRehash('garbage')).toBe(true);
  });
});
