import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, isPasswordHash, signToken, verifyToken, resolveAuthSecret, TOKEN_TTL_MS } from './auth';

const SECRET = 'test-secret-that-is-definitely-longer-than-32-chars';
const NOW = Date.UTC(2026, 9, 23, 12);

test('password hashes are salted scrypt and verify only the right password', async () => {
  const a = await hashPassword('correct horse');
  const b = await hashPassword('correct horse');
  assert.ok(isPasswordHash(a));
  assert.ok(a.startsWith('scrypt$32768$8$1$'));
  assert.notEqual(a, b, 'same password must hash differently (unique salt)');
  assert.ok(!a.includes('correct horse'));
  assert.equal(await verifyPassword('correct horse', a), true);
  assert.equal(await verifyPassword('correct horsf', a), false);
  assert.equal(await verifyPassword('', a), false);
});

test('malformed or absurd-cost hashes are rejected without throwing', async () => {
  assert.equal(await verifyPassword('x', 'password123'), false);
  assert.equal(await verifyPassword('x', 'scrypt$1073741824$8$1$AAAA$AAAA'), false);
  assert.equal(await verifyPassword('x', ''), false);
});

test('a signed token round-trips to its claims', () => {
  const t = signToken('user_1', SECRET, NOW);
  assert.match(t, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(verifyToken(t, SECRET, NOW + 1000), { sub: 'user_1', iat: NOW, exp: NOW + TOKEN_TTL_MS });
});

test('the old unsigned base64 token is rejected', () => {
  const legacy = Buffer.from(JSON.stringify({ sub: 'demo_user', exp: NOW + 1e9 })).toString('base64');
  assert.equal(verifyToken(legacy, SECRET, NOW), null);
});

test('tampered payload, wrong key, wrong version and garbage are rejected', () => {
  const t = signToken('user_1', SECRET, NOW);
  const [v, , sig] = t.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ sub: 'user_2', iat: NOW, exp: NOW + 1000 })).toString('base64url');
  assert.equal(verifyToken(`${v}.${forgedPayload}.${sig}`, SECRET, NOW), null);
  assert.equal(verifyToken(signToken('user_1', 'another-secret-also-longer-than-32-chars!!', NOW), SECRET, NOW), null);
  assert.equal(verifyToken(t.replace(/^v1/, 'v2'), SECRET, NOW), null);
  for (const junk of ['', 'abc', 'v1..', `${t}x`, 42, null, undefined]) assert.equal(verifyToken(junk, SECRET, NOW), null);
});

test('expired tokens, tokens from the future and over-long lifetimes are rejected', () => {
  assert.equal(verifyToken(signToken('u', SECRET, NOW - TOKEN_TTL_MS - 1), SECRET, NOW), null);
  assert.equal(verifyToken(signToken('u', SECRET, NOW + 10 * 60 * 1000), SECRET, NOW), null);
  assert.equal(verifyToken(signToken('u', SECRET, NOW, 30 * 24 * 3600 * 1000), SECRET, NOW), null);
});

test('AUTH_SECRET: used when long enough, refused when short, random when absent', () => {
  assert.deepEqual(resolveAuthSecret({ AUTH_SECRET: SECRET } as any), { secret: SECRET, ephemeral: false });
  assert.throws(() => resolveAuthSecret({ AUTH_SECRET: 'short' } as any));
  const a = resolveAuthSecret({} as any);
  const b = resolveAuthSecret({} as any);
  assert.equal(a.ephemeral, true);
  assert.notEqual(a.secret, b.secret);
  assert.ok(a.secret.length >= 32);
});
