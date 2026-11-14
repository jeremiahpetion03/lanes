// Bundle the React app into dist/ (served by the Node server).
//   node scripts/build.mjs          production build (minified)
//   node scripts/build.mjs --watch  rebuild on every change
import { context } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');

await rm('dist', { recursive: true, force: true });
await mkdir('dist/assets', { recursive: true });

const copyStatic = async () => {
  await cp('web/index.html', 'dist/index.html');
  await cp('web/styles.css', 'dist/assets/styles.css');
};
await copyStatic();

const ctx = await context({
  entryPoints: ['web/src/main.tsx'],
  outfile: 'dist/assets/app.js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  minify: !watch,
  sourcemap: true,
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  logLevel: 'info',
  plugins: [{ name: 'copy-static', setup: (b) => b.onEnd(copyStatic) }],
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
