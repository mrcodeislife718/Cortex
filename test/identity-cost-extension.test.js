import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OidcPkceClient } from '../src/oidc-identity.js';
import { DeterministicRequestCache, QuotaManager, SpendPolicy, QuotaExceededError } from '../src/cost-controls.js';
import { ExtensionPackageVerifier, TransactionalExtensionInstaller, MarketplacePolicy } from '../src/extension-packages.js';

test('OIDC PKCE authorization uses S256 and validates signed ID token identity', async () => {
  let now = 1_700_000_000_000;
  const issuer = 'https://id.example.test';
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'key-1'; jwk.alg = 'RS256'; jwk.use = 'sig';
  let pendingNonce;
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith('/.well-known/openid-configuration')) return response({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
    if (url.endsWith('/jwks')) return response({ keys: [jwk] });
    if (url.endsWith('/token')) {
      const nowSeconds = Math.floor(now / 1000);
      const header = encode({ alg: 'RS256', typ: 'JWT', kid: 'key-1' });
      const payload = encode({ iss: issuer, aud: 'cortex-client', sub: 'user-1', exp: nowSeconds + 300, iat: nowSeconds, nonce: pendingNonce });
      const body = `${header}.${payload}`;
      const signature = crypto.sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url');
      assert.ok(String(options.body).includes('code_verifier='));
      return response({ id_token: `${body}.${signature}`, access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const client = new OidcPkceClient({ issuer, clientId: 'cortex-client', redirectUri: 'http://127.0.0.1/callback', fetchImpl, clock: () => now });
  const authorization = await client.createAuthorization();
  pendingNonce = authorization.nonce;
  const url = new URL(authorization.url);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('code_challenge'));
  const tokens = await client.exchange({ code: 'code-1', state: authorization.state });
  assert.equal(tokens.identity.sub, 'user-1');
  assert.equal(tokens.accessToken, 'access');
});

test('OIDC rejects state mismatch before token exchange', async () => {
  const client = new OidcPkceClient({ issuer: 'https://id.example.test', clientId: 'cortex', redirectUri: 'http://localhost/cb', fetchImpl: async () => response({ issuer: 'https://id.example.test', authorization_endpoint: 'https://id.example.test/a', token_endpoint: 'https://id.example.test/t', jwks_uri: 'https://id.example.test/j' }) });
  await client.createAuthorization();
  await assert.rejects(client.exchange({ code: 'x', state: 'attacker-state' }), /state mismatch/);
});

test('cost controls cache by scope and enforce quotas and spend ceilings', () => {
  let now = 100;
  const cache = new DeterministicRequestCache({ ttlMs: 50, clock: () => now });
  cache.set({ prompt: 'x' }, { text: 'a' }, { scope: 'repo-a' });
  cache.set({ prompt: 'x' }, { text: 'b' }, { scope: 'repo-b' });
  assert.equal(cache.get({ prompt: 'x' }, { scope: 'repo-a' }).text, 'a');
  assert.equal(cache.invalidateScope('repo-a'), 1);
  assert.equal(cache.get({ prompt: 'x' }, { scope: 'repo-a' }), null);
  assert.equal(cache.get({ prompt: 'x' }, { scope: 'repo-b' }).text, 'b');
  now = 200;
  assert.equal(cache.get({ prompt: 'x' }, { scope: 'repo-b' }), null);

  const quotas = new QuotaManager({ limits: { hostedRequests: 2 }, clock: () => new Date('2026-08-28T12:00:00Z') });
  quotas.consume('acct', 'hostedRequests'); quotas.consume('acct', 'hostedRequests');
  assert.throws(() => quotas.consume('acct', 'hostedRequests'), QuotaExceededError);
  const spend = new SpendPolicy({ perRequestUsd: 1, dailyUsd: 2, monthlyUsd: 3, clock: () => new Date('2026-08-28T12:00:00Z') });
  spend.record(0.75); spend.record(0.75);
  assert.equal(spend.authorize(0.75).allowed, false);
});

test('extension packages require trusted publisher signature and support transactional rollback', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-extension-package-'));
  try {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const bytes1 = Buffer.from('extension-v1');
    const digest1 = crypto.createHash('sha256').update(bytes1).digest('hex');
    const manifest1 = { id: 'acme.tool', version: '1.0.0', sha256: digest1 };
    const signature1 = crypto.sign(null, Buffer.from(`acme.tool\n1.0.0\n${digest1}`), privateKey).toString('base64');
    const verifier = new ExtensionPackageVerifier({ trustedPublishers: { acme: publicKey } });
    const verified = await verifier.verify({ manifest: manifest1, bytes: bytes1, signatureBase64: signature1, publisher: 'acme' });
    assert.equal(verified.verified, true);
    assert.equal(new MarketplacePolicy().evaluate(verified).allowed, true);

    const installer = new TransactionalExtensionInstaller({ root });
    await installer.install({ id: 'acme.tool', version: '1.0.0', bytes: bytes1, sha256: digest1 });
    const bytes2 = Buffer.from('extension-v2');
    const digest2 = crypto.createHash('sha256').update(bytes2).digest('hex');
    await installer.install({ id: 'acme.tool', version: '2.0.0', bytes: bytes2, sha256: digest2 });
    assert.equal(await installer.current('acme.tool'), '2.0.0');
    assert.equal((await installer.rollback('acme.tool')).version, '1.0.0');
    assert.equal(await installer.current('acme.tool'), '1.0.0');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

function response(body, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => body }; }
function encode(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
