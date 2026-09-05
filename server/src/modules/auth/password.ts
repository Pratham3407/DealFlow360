import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';

/**
 * `promisify(scrypt)` resolves to the 3-argument overload and drops the options
 * parameter, so the callback form is wrapped by hand to keep cost parameters
 * explicit and typed.
 */
function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

/**
 * Password hashing using scrypt from node:crypto.
 *
 * scrypt is memory-hard and ships with Node, so there is no native build step
 * on Windows and no extra dependency (AGENTS.md 29). Parameters are stored
 * inside each hash, which means they can be raised later without invalidating
 * existing credentials - `needsRehash` reports when a stored hash is weaker
 * than the current policy.
 *
 * Encoded form: scrypt$N$r$p$keylen$<salt-b64>$<hash-b64>
 */
const CURRENT = {
  /** CPU/memory cost. 2^16 keeps a single hash around 100ms on typical hardware. */
  N: 65_536,
  /** Block size. */
  r: 8,
  /** Parallelisation. */
  p: 1,
  keyLength: 64,
  saltLength: 16,
} as const;

// scrypt needs maxmem >= 128 * N * r, with headroom for the internal buffers.
const MAX_MEM = 256 * CURRENT.N * CURRENT.r;

const ALGORITHM = 'scrypt';

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  keyLength: number;
  salt: Buffer;
  hash: Buffer;
}

function parseHash(encoded: string): ParsedHash | null {
  const parts = encoded.split('$');
  if (parts.length !== 7) return null;
  const [algorithm, rawN, rawR, rawP, rawKeyLength, rawSalt, rawHash] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (algorithm !== ALGORITHM) return null;

  const N = Number.parseInt(rawN, 10);
  const r = Number.parseInt(rawR, 10);
  const p = Number.parseInt(rawP, 10);
  const keyLength = Number.parseInt(rawKeyLength, 10);
  if (![N, r, p, keyLength].every((value) => Number.isInteger(value) && value > 0)) return null;

  try {
    const salt = Buffer.from(rawSalt, 'base64');
    const hash = Buffer.from(rawHash, 'base64');
    if (salt.length === 0 || hash.length !== keyLength) return null;
    return { N, r, p, keyLength, salt, hash };
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(CURRENT.saltLength);
  const derived = await scrypt(password, salt, CURRENT.keyLength, {
    N: CURRENT.N,
    r: CURRENT.r,
    p: CURRENT.p,
    maxmem: MAX_MEM,
  });

  return [
    ALGORITHM,
    CURRENT.N,
    CURRENT.r,
    CURRENT.p,
    CURRENT.keyLength,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/**
 * Constant-time password verification. Returns false rather than throwing for
 * malformed stored hashes so a corrupt row cannot be distinguished from a wrong
 * password by an attacker.
 */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = parseHash(encoded);
  if (!parsed) return false;

  try {
    const derived = await scrypt(password, parsed.salt, parsed.keyLength, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: Math.max(MAX_MEM, 256 * parsed.N * parsed.r),
    });

    return derived.length === parsed.hash.length && timingSafeEqual(derived, parsed.hash);
  } catch {
    return false;
  }
}

/** True when a stored hash was produced with weaker parameters than current policy. */
export function needsRehash(encoded: string): boolean {
  const parsed = parseHash(encoded);
  if (!parsed) return true;
  return (
    parsed.N < CURRENT.N ||
    parsed.r < CURRENT.r ||
    parsed.p < CURRENT.p ||
    parsed.keyLength < CURRENT.keyLength
  );
}
