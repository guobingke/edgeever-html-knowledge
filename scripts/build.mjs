import { build } from 'esbuild';
import { cp, mkdir, stat, readFile, writeFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/main.js'], bundle: true, format: 'esm',
  outfile: 'dist/main.js', target: ['chrome110', 'firefox115', 'safari16.4'],
  minify: true, legalComments: 'eof',
});
await cp('manifest.json', 'dist/manifest.json');
await cp('README.md', 'dist/README.md');
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const licenses = [];
for (const [location, info] of Object.entries(lock.packages)) {
  if (!location || info.dev) continue;
  const metadata = JSON.parse(await readFile(`${location}/package.json`, 'utf8'));
  let licenseText = '';
  for (const filename of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md']) {
    try { licenseText = await readFile(`${location}/${filename}`, 'utf8'); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!licenseText) throw new Error(`Missing third-party license: ${metadata.name}`);
  licenses.push(`${metadata.name}@${metadata.version} (${metadata.license})\n${licenseText}`);
}
await writeFile('dist/THIRD_PARTY_NOTICES.txt', licenses.join('\n\n----------------------------------------\n\n'));
if ((await stat('dist/main.js')).size > 5 * 1024 * 1024) throw new Error('Bundle exceeds host 5 MiB limit');
console.log('Built dist/manifest.json + dist/main.js');
