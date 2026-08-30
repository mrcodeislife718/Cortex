import crypto from 'node:crypto';

const clone = (value) => globalThis.structuredClone(value);

export class OidcPkceClient {
  constructor({ issuer, clientId, redirectUri, fetchImpl = globalThis.fetch, clock = () => Date.now(), allowedAlgorithms = ['RS256'] } = {}) {
    if (!issuer || !clientId || !redirectUri) throw new Error('OIDC issuer, clientId and redirectUri are required');
    if (typeof fetchImpl !== 'function') throw new Error('OIDC client requires fetch');
    this.issuer = issuer.replace(/\/$/, '');
    this.clientId = clientId;
    this.redirectUri = redirectUri;
    this.fetchImpl = fetchImpl;
    this.clock = clock;
    this.allowedAlgorithms = new Set(allowedAlgorithms);
    this.discovery = null;
    this.pending = new Map();
  }

  async discover() {
    const response = await this.fetchImpl(`${this.issuer}/.well-known/openid-configuration`, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`OIDC discovery failed (${response.status})`);
    const discovery = await response.json();
    for (const key of ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri']) if (!discovery[key]) throw new Error(`OIDC discovery missing ${key}`);
    if (discovery.issuer.replace(/\/$/, '') !== this.issuer) throw new Error('OIDC discovery issuer mismatch');
    this.discovery = discovery;
    return clone(discovery);
  }

  async createAuthorization({ scopes = ['openid', 'profile', 'email'], prompt = null, extra = {} } = {}) {
    const discovery = this.discovery ?? await this.discover();
    const state = randomUrlSafe(32);
    const nonce = randomUrlSafe(32);
    const verifier = randomUrlSafe(64);
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const params = new URLSearchParams({
      response_type: 'code', client_id: this.clientId, redirect_uri: this.redirectUri,
      scope: [...new Set(scopes)].join(' '), state, nonce, code_challenge: challenge, code_challenge_method: 'S256',
    });
    if (prompt) params.set('prompt', prompt);
    for (const [key, value] of Object.entries(extra)) params.set(key, String(value));
    this.pending.set(state, { verifier, nonce, createdAt: this.clock() });
    return { url: `${discovery.authorization_endpoint}?${params}`, state, nonce, verifier };
  }

  async exchange({ code, state, maxStateAgeMs = 10 * 60 * 1000 }) {
    if (!code || !state) throw new Error('OIDC callback requires code and state');
    const pending = this.pending.get(state);
    this.pending.delete(state);
    if (!pending) throw new Error('OIDC state mismatch');
    if (this.clock() - pending.createdAt > maxStateAgeMs) throw new Error('OIDC authorization state expired');
    const discovery = this.discovery ?? await this.discover();
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: this.clientId, redirect_uri: this.redirectUri, code_verifier: pending.verifier });
    const response = await this.fetchImpl(discovery.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body });
    const tokens = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`OIDC token exchange failed (${response.status}): ${tokens?.error_description ?? tokens?.error ?? 'unknown error'}`);
    if (!tokens?.id_token) throw new Error('OIDC token response missing id_token');
    const identity = await this.verifyIdToken(tokens.id_token, { nonce: pending.nonce });
    return { identity, accessToken: tokens.access_token ?? null, refreshToken: tokens.refresh_token ?? null, expiresIn: tokens.expires_in ?? null, scope: tokens.scope ?? null };
  }

  async verifyIdToken(token, { nonce = null } = {}) {
    const parts = String(token).split('.');
    if (parts.length !== 3) throw new Error('invalid OIDC ID token');
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!this.allowedAlgorithms.has(header.alg)) throw new Error(`OIDC signing algorithm not allowed: ${header.alg}`);
    const discovery = this.discovery ?? await this.discover();
    const jwksResponse = await this.fetchImpl(discovery.jwks_uri, { headers: { accept: 'application/json' } });
    if (!jwksResponse.ok) throw new Error(`OIDC JWKS fetch failed (${jwksResponse.status})`);
    const jwks = await jwksResponse.json();
    const jwk = jwks.keys?.find((key) => key.kid === header.kid && (!key.alg || key.alg === header.alg));
    if (!jwk) throw new Error('OIDC signing key not found');
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const signatureOk = verifyJwtSignature(header.alg, `${parts[0]}.${parts[1]}`, parts[2], key);
    if (!signatureOk) throw new Error('invalid OIDC ID token signature');
    const now = Math.floor(this.clock() / 1000);
    if (payload.iss?.replace(/\/$/, '') !== this.issuer) throw new Error('OIDC ID token issuer mismatch');
    const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audience.includes(this.clientId)) throw new Error('OIDC ID token audience mismatch');
    if (!payload.exp || payload.exp <= now) throw new Error('OIDC ID token expired');
    if (payload.nbf && payload.nbf > now) throw new Error('OIDC ID token not yet valid');
    if (nonce && payload.nonce !== nonce) throw new Error('OIDC ID token nonce mismatch');
    if (!payload.sub) throw new Error('OIDC ID token subject missing');
    return clone(payload);
  }
}

export class RefreshTokenCoordinator {
  constructor({ client, vault, clock = () => Date.now(), refreshSkewSeconds = 60 } = {}) {
    if (!client || !vault) throw new Error('refresh coordinator requires OIDC client and credential vault');
    this.client = client; this.vault = vault; this.clock = clock; this.refreshSkewSeconds = refreshSkewSeconds;
  }
  async store(accountId, tokens) {
    if (!accountId) throw new Error('accountId is required');
    const expiresAt = tokens.expiresIn ? this.clock() + Number(tokens.expiresIn) * 1000 : null;
    await this.vault.set(`oidc:${accountId}`, { refreshToken: tokens.refreshToken, accessToken: tokens.accessToken, expiresAt });
  }
  async clear(accountId) { await this.vault.delete(`oidc:${accountId}`); }
}

function verifyJwtSignature(alg, signingInput, signature, key) {
  const algorithms = { RS256: 'RSA-SHA256', RS384: 'RSA-SHA384', RS512: 'RSA-SHA512', ES256: 'SHA256', ES384: 'SHA384', ES512: 'SHA512' };
  const algorithm = algorithms[alg];
  if (!algorithm) throw new Error(`unsupported JWT signature algorithm: ${alg}`);
  return crypto.verify(algorithm, Buffer.from(signingInput), key, Buffer.from(signature, 'base64url'));
}
function randomUrlSafe(bytes) { return crypto.randomBytes(bytes).toString('base64url'); }
