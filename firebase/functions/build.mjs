// Bundles the functions (and the shared send logic) into dist/, with a
// package.json listing only what Cloud Build must install.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: Object.keys(pkg.dependencies),
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});
writeFileSync(
  'dist/package.json',
  JSON.stringify({ name: 'logbook-functions', private: true, type: 'module', main: 'index.js', engines: { node: '22' }, dependencies: pkg.dependencies }, null, 2) + '\n',
);
