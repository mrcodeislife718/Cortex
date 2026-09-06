import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const clone = (value) => globalThis.structuredClone(value);

export class ExtensionPackageVerifier {
  constructor({ trustedPublishers = {}, malwareScanner = null } = {}) {
    this.trustedPublishers = new Map(Object.entries(trustedPublishers));
    this.malwareScanner = malwareScanner;
  }
  async verify({ manifest, bytes, signatureBase64, publisher }) {
    if (!manifest?.id || !manifest?.version || !publisher || !Buffer.isBuffer(bytes)) throw new Error('invalid extension package');
    if (!manifest.id.startsWith(`${publisher}.`)) throw new Error('extension publisher does not match extension id');
    const publicKey = this.trustedPublishers.get(publisher);
    if (!publicKey) throw new Error(`untrusted extension publisher: ${publisher}`);
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    if (manifest.sha256 && manifest.sha256 !== digest) throw new Error('extension package checksum mismatch');
    const signed = `${manifest.id}\n${manifest.version}\n${digest}`;
    if (typeof signatureBase64 !== 'string' || !signatureBase64 || !crypto.verify(null, Buffer.from(signed), publicKey, Buffer.from(signatureBase64, 'base64'))) throw new Error('extension package signature invalid');
    if (this.malwareScanner) {
      const scan = await this.malwareScanner({ manifest: clone(manifest), bytes });
      if (!scan?.clean) throw new Error(`extension package rejected by security scan: ${scan?.reason ?? 'unknown finding'}`);
    }
    return { id: manifest.id, version: manifest.version, publisher, sha256: digest, verified: true };
  }
}

export class TransactionalExtensionInstaller {
  constructor({ root, fileSystem = fs } = {}) {
    if (!root) throw new Error('extension install root is required');
    this.root = path.resolve(root); this.fileSystem = fileSystem;
  }
  async install({ id, version, bytes, sha256 }) {
    validateId(id); validateVersion(version);
    if (!Buffer.isBuffer(bytes)) throw new TypeError('extension artifact bytes must be a Buffer');
    if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(sha256)) throw new TypeError('extension artifact sha256 must be a 64-character hex digest');
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    if (digest !== sha256.toLowerCase()) throw new Error('extension artifact checksum mismatch');
    const extensionRoot = path.join(this.root, safeSegment(id));
    const releases = path.join(extensionRoot, 'releases');
    const target = path.join(releases, safeSegment(version), 'extension.pkg');
    await this.fileSystem.mkdir(path.dirname(target), { recursive: true });

    const existing = await readOptionalBytes(this.fileSystem, target);
    if (existing) {
      const existingDigest = crypto.createHash('sha256').update(existing).digest('hex');
      if (existingDigest !== digest) throw new Error(`extension ${id}@${version} already exists with different artifact bytes`);
    } else {
      await atomicCreateBytes(this.fileSystem, target, bytes, digest);
    }

    const currentFile = path.join(extensionRoot, 'current');
    const previousFile = path.join(extensionRoot, 'previous');
    const current = await readOptional(this.fileSystem, currentFile);
    if (current?.trim() === version) return { id, version, sha256: digest, previous: (await readOptional(this.fileSystem, previousFile))?.trim() ?? null, target, unchanged: true };
    if (current) await atomicWrite(this.fileSystem, previousFile, current.trim());
    await atomicWrite(this.fileSystem, currentFile, version);
    return { id, version, sha256: digest, previous: current?.trim() ?? null, target, unchanged: false };
  }
  async rollback(id) {
    validateId(id);
    const extensionRoot = path.join(this.root, safeSegment(id));
    const currentFile = path.join(extensionRoot, 'current');
    const previousFile = path.join(extensionRoot, 'previous');
    const previous = (await this.fileSystem.readFile(previousFile, 'utf8')).trim();
    validateVersion(previous);
    const release = path.join(extensionRoot, 'releases', safeSegment(previous), 'extension.pkg');
    await this.fileSystem.access(release);
    const current = (await readOptional(this.fileSystem, currentFile))?.trim() ?? null;
    await atomicWrite(this.fileSystem, currentFile, previous);
    if (current) await atomicWrite(this.fileSystem, previousFile, current);
    return { id, version: previous, replaced: current };
  }
  async current(id) { validateId(id); return (await readOptional(this.fileSystem, path.join(this.root, safeSegment(id), 'current')))?.trim() ?? null; }
}

export class MarketplacePolicy {
  constructor({ allowUnverified = false, allowPublishers = ['*'], denyExtensions = [] } = {}) {
    this.allowUnverified = allowUnverified; this.allowPublishers = new Set(allowPublishers); this.denyExtensions = new Set(denyExtensions);
  }
  evaluate({ id, publisher, verified }) {
    const reasons = [];
    if (this.denyExtensions.has(id)) reasons.push('extension-denied');
    if (!this.allowPublishers.has('*') && !this.allowPublishers.has(publisher)) reasons.push('publisher-not-allowed');
    if (!verified && !this.allowUnverified) reasons.push('signature-required');
    return { allowed: reasons.length === 0, reasons };
  }
}

function validateId(id) { if (!/^[A-Za-z0-9][A-Za-z0-9._-]+$/.test(id ?? '')) throw new Error('invalid extension id'); }
function validateVersion(version) { if (!/^[0-9A-Za-z][0-9A-Za-z._+-]*$/.test(version ?? '')) throw new Error('invalid extension version'); }
function safeSegment(value) { return value.replace(/[^A-Za-z0-9._+-]/g, '_'); }
async function readOptional(fileSystem, file) { try { return await fileSystem.readFile(file, 'utf8'); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; } }
async function readOptionalBytes(fileSystem, file) { try { return await fileSystem.readFile(file); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; } }

async function atomicCreateBytes(fileSystem, target, bytes, expectedDigest) {
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  try {
    await durableWrite(fileSystem, temporary, bytes, 0o600);
    const staged = await fileSystem.readFile(temporary);
    const stagedDigest = crypto.createHash('sha256').update(staged).digest('hex');
    if (stagedDigest !== expectedDigest) throw new Error('staged extension artifact checksum mismatch');
    if (typeof fileSystem.link === 'function') {
      try { await fileSystem.link(temporary, target); }
      catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        const existing = await fileSystem.readFile(target);
        const existingDigest = crypto.createHash('sha256').update(existing).digest('hex');
        if (existingDigest !== expectedDigest) throw new Error('extension version raced with a different artifact');
      }
      await fileSystem.rm(temporary, { force: true });
    } else {
      const existing = await readOptionalBytes(fileSystem, target);
      if (existing) {
        const existingDigest = crypto.createHash('sha256').update(existing).digest('hex');
        if (existingDigest !== expectedDigest) throw new Error('extension version already exists with different artifact');
        await fileSystem.rm?.(temporary, { force: true });
      } else {
        await fileSystem.rename(temporary, target);
      }
    }
  } catch (error) {
    try { await fileSystem.rm?.(temporary, { force: true }); } catch {}
    throw error;
  }
}

async function atomicWrite(fileSystem, file, text) {
  await fileSystem.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await durableWrite(fileSystem, temp, Buffer.from(String(text)), 0o600);
    await fileSystem.rename(temp, file);
  } catch (error) {
    try { await fileSystem.rm?.(temp, { force: true }); } catch {}
    throw error;
  }
}

async function durableWrite(fileSystem, file, bytes, mode) {
  if (typeof fileSystem.open === 'function') {
    const handle = await fileSystem.open(file, 'wx', mode);
    try { await handle.writeFile(bytes); await handle.sync?.(); }
    finally { await handle.close(); }
    return;
  }
  await fileSystem.writeFile(file, bytes, { mode, flag: 'wx' });
}
