// Password hashing and session tokens, built on node:crypto only.
//
// Passwords: scrypt with a fresh 16-byte salt per password, stored as
//   scrypt$N$r$p$<salt b64>$<key b64>
// so the cost can be raised later without breaking existing hashes.
//
// Tokens: v1.<payload b64url>.<HMAC-SHA256 b64url>, signed with AUTH_SECRET.
// The old unsigned base64 tokens have no dots and are rejected outright.

import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scrypt = (password: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)))
  );

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
  keylen: number;
}

// N=2^15, r=8: ~32 MB and tens of milliseconds per hash on a laptop CPU.
export const DEFAULT_SCRYPT: ScryptParams = { N: 1 << 15, r: 8, p: 1, keylen: 64 };
// Refuse to verify hashes claiming absurd costs, so a tampered store cannot
// make one login request burn gigabytes of memory.
const MAX_N = 1 << 20;
const MAX_PASSWORD_LENGTH = 128;

const maxmemFor = (p: ScryptParams) => 128 * p.N * p.r * 2 + 1024 * 1024;

export async function hashPassword(password: string, params: ScryptParams = DEFAULT_SCRYPT): Promise<string> {
  if (typeof password !== 'string' || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
    throw new Error('password must be a non-empty string of at most 128 characters');
  }
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, params.keylen, { N: params.N, r: params.r, p: params.p, maxmem: maxmemFor(params) });
  return ['scrypt', params.N, params.r, params.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export function isPasswordHash(value: unknown): value is string {
  return typeof value === 'string' && /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(value);
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof password !== 'string' || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) return false;
  if (!isPasswordHash(stored)) return false;
  const [, nS, rS, pS, saltB64, keyB64] = stored.split('$');
  const params = { N: Number(nS), r: Number(rS), p: Number(pS) };
  if (!Number.isInteger(params.N) || params.N < 2 || params.N > MAX_N || (params.N & (params.N - 1)) !== 0) return false;
  if (!Number.isInteger(params.r) || params.r < 1 || params.r > 32) return false;
  if (!Number.isInteger(params.p) || params.p < 1 || params.p > 16) return false;
  const expected = Buffer.from(keyB64, 'base64');
  if (expected.length < 16 || expected.length > 128) return false;
  const derived = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    ...params,
    maxmem: maxmemFor({ ...params, keylen: expected.length })
  });
  return timingSafeEqual(derived, expected);
}

// Used when the username does not exist, so a failed login takes about as
// long either way and response time does not reveal which usernames exist.
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(password: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(12).toString('hex'));
  await verifyPassword(typeof password === 'string' && password ? password.slice(0, MAX_PASSWORD_LENGTH) : 'x', await dummyHash);
  return false;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;
const TOKEN_RE = /^v1\.([A-Za-z0-9_-]{8,2048})\.([A-Za-z0-9_-]{43})$/;

export interface TokenClaims {
  sub: string; // user id
  iat: number; // ms since epoch
  exp: number; // ms since epoch
}

const b64url = (buf: Buffer) => buf.toString('base64url');
const mac = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest();

export function signToken(userId: string, secret: string, now: number = Date.now(), ttlMs: number = TOKEN_TTL_MS): string {
  const payload = b64url(Buffer.from(JSON.stringify({ sub: userId, iat: now, exp: now + ttlMs })));
  return `v1.${payload}.${b64url(mac(secret, `v1.${payload}`))}`;
}

export function verifyToken(token: unknown, secret: string, now: number = Date.now()): TokenClaims | null {
  if (typeof token !== 'string') return null;
  const m = TOKEN_RE.exec(token);
  if (!m) return null;
  const [, payload, sig] = m;

  const given = Buffer.from(sig, 'base64url');
  const expected = mac(secret, `v1.${payload}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let claims: any;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
  if (!claims || typeof claims !== 'object') return null;
  const { sub, iat, exp } = claims;
  if (typeof sub !== 'string' || sub.length === 0 || sub.length > 200) return null;
  if (!Number.isFinite(iat) || !Number.isFinite(exp)) return null;
  if (exp <= now) return null;
  if (iat > now + CLOCK_SKEW_MS) return null;
  if (exp - iat > MAX_TOKEN_LIFETIME_MS) return null;
  return { sub, iat, exp };
}

// AUTH_SECRET comes from the server environment only. Without one, a random
// per-process secret is used: sessions then end when the server restarts,
// which is safe, and nothing is hardcoded.
export function resolveAuthSecret(env: NodeJS.ProcessEnv = process.env): { secret: string; ephemeral: boolean } {
  const configured = env.AUTH_SECRET;
  if (configured !== undefined && configured !== '') {
    if (configured.length < 32) {
      throw new Error('AUTH_SECRET is set but shorter than 32 characters; refusing to start with a weak signing key');
    }
    return { secret: configured, ephemeral: false };
  }
  return { secret: randomBytes(48).toString('base64url'), ephemeral: true };
}
