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
    if (!crypto.verify(null, Buffer.from(signed), publicKey, Buffer.from(signatureBase64, 'base64'))) throw new Error('extension package signature invalid');
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
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    if (digest !== sha256) throw new Error('extension artifact checksum mismatch');
    const extensionRoot = path.join(this.root, safeSegment(id));
    const releases = path.join(extensionRoot, 'releases');
    const target = path.join(releases, safeSegment(version), 'extension.pkg');
    await this.fileSystem.mkdir(path.dirname(target), { recursive: true });
    await this.fileSystem.writeFile(target, bytes, { mode: 0o600 });
    const currentFile = path.join(extensionRoot, 'current');
    const previousFile = path.join(extensionRoot, 'previous');
    const current = await readOptional(this.fileSystem, currentFile);
    if (current) await atomicWrite(this.fileSystem, previousFile, current.trim());
    await atomicWrite(this.fileSystem, currentFile, version);
    return { id, version, sha256: digest, previous: current?.trim() ?? null, target };
  }
  async rollback(id) {
    validateId(id);
    const extensionRoot = path.join(this.root, safeSegment(id));
    const currentFile = path.join(extensionRoot, 'current');
    const previousFile = path.join(extensionRoot, 'previous');
    const previous = (await this.fileSystem.readFile(previousFile, 'utf8')).trim();
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
async function atomicWrite(fileSystem, file, text) { await fileSystem.mkdir(path.dirname(file), { recursive: true }); const temp = `${file}.${crypto.randomUUID()}.tmp`; await fileSystem.writeFile(temp, text, { mode: 0o600 }); await fileSystem.rename(temp, file); }
