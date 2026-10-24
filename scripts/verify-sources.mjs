import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/consolidation-manifest.json'), 'utf8'));
const expectedNames = new Set(['EdgeFusion', 'EdgeBoard', 'edgeboard-appdeploy', 'SportsBettingApp',
  'sports-odds-api-python', 'OddsHarvester', 'live-odds-tracker', 'alexbet-sharp-bot']);
const failures = [];
let checked = 0;
for (const source of manifest.sources) {
  if (!expectedNames.delete(source.name)) failures.push(`Unexpected or duplicate source: ${source.name}`);
  if (!/^[0-9a-f]{40}$/.test(source.commit)) failures.push(`Invalid revision: ${source.name}`);
  const folder = path.resolve(root, source.path);
  if (!folder.startsWith(path.join(root, 'sources') + path.sep)) {
    failures.push(`Invalid source directory: ${source.name}`);
    continue;
  }
  const expectedFiles = new Set(source.files.map(file => file.path));
  for (const file of source.files) {
    const absolute = path.resolve(folder, file.path);
    if (!absolute.startsWith(folder + path.sep)) {
      failures.push(`Unsafe path: ${source.name}`);
      continue;
    }
    try {
      if (!fs.lstatSync(absolute).isFile()) throw Error('Not a regular file');
      const content = fs.readFileSync(absolute);
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      if (hash !== file.sha256 || content.length !== file.bytes)
        failures.push(`Source differs from manifest: ${source.name}/${file.path}`);
      checked++;
    } catch {
      failures.push(`Source missing or unreadable: ${source.name}/${file.path}`);
    }
  }
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(folder, absolute).split(path.sep).join('/');
      if (entry.isDirectory()) walk(absolute);
      else if (!entry.isFile() || !expectedFiles.has(relative))
        failures.push(`Unmanifested source: ${source.name}/${relative}`);
    }
  }
  walk(folder);
  for (const excluded of source.exclusions) {
    if (fs.existsSync(path.join(folder, excluded.path)))
      failures.push(`Excluded file present: ${source.name}/${excluded.path}`);
  }
}
for (const name of expectedNames) failures.push(`Missing source: ${name}`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Verified ${manifest.sources.length} source repositories and ${checked} SHA-256 file hashes.`);
}
