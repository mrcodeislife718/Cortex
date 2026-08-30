import fs from 'node:fs/promises';
import path from 'node:path';

const [rootArg = 'release-assets', outputArg = 'latest.json'] = process.argv.slice(2);
const tag = process.env.GITHUB_REF_NAME ?? process.env.CORTEX_RELEASE_TAG;
const repository = process.env.GITHUB_REPOSITORY ?? 'mrcodeislife718/Cortex';
if (!tag || !/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(tag)) throw new Error('a SemVer release tag is required');

const root = path.resolve(rootArg);
const files = await walk(root);
const metadataFiles = files.filter((file) => path.basename(file) === 'cortex-update-target.json');
if (!metadataFiles.length) throw new Error('no Cortex update target metadata found');

const platforms = {};
for (const metadataFile of metadataFiles) {
  const metadata = JSON.parse(await fs.readFile(metadataFile, 'utf8'));
  if (!metadata.target || !metadata.artifact) throw new Error(`invalid update metadata: ${metadataFile}`);
  if (platforms[metadata.target]) throw new Error(`duplicate update target: ${metadata.target}`);
  const artifactRoot = path.dirname(metadataFile);
  const candidates = files.filter((file) => file.startsWith(`${artifactRoot}${path.sep}`) && file.endsWith('.sig'));
  const signatureFile = selectSignature(metadata.target, candidates);
  if (!signatureFile) throw new Error(`missing updater signature for ${metadata.target}`);
  const bundleFile = signatureFile.slice(0, -4);
  await fs.access(bundleFile);
  const fileName = path.basename(bundleFile);
  const signature = (await fs.readFile(signatureFile, 'utf8')).trim();
  if (!signature) throw new Error(`empty updater signature for ${metadata.target}`);
  platforms[metadata.target] = {
    signature,
    url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(fileName)}`,
  };
}

const required = ['linux-x86_64', 'windows-x86_64', 'darwin-aarch64'];
for (const target of required) if (!platforms[target]) throw new Error(`release is missing required Cortex update target: ${target}`);

const manifest = {
  version: tag.replace(/^v/, ''),
  notes: `Cortex ${tag}`,
  pub_date: new Date().toISOString(),
  platforms,
};
await fs.writeFile(path.resolve(outputArg), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
console.log(`Generated ${outputArg} for ${Object.keys(platforms).join(', ')}`);

function selectSignature(target, candidates) {
  const ordered = target.startsWith('linux-')
    ? [/\.AppImage\.sig$/]
    : target.startsWith('darwin-')
      ? [/\.app\.tar\.gz\.sig$/]
      : [/-setup\.exe\.sig$/i, /\.exe\.sig$/i, /\.msi\.sig$/i];
  for (const pattern of ordered) {
    const matches = candidates.filter((file) => pattern.test(file)).sort();
    if (matches.length) return matches[0];
  }
  return null;
}

async function walk(directory) {
  const output = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(full));
    else if (entry.isFile()) output.push(full);
  }
  return output;
}
