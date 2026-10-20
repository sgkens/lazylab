import { mkdir, rm } from 'node:fs/promises';

export async function buildAssets() {
  await rm('.generated', { recursive: true, force: true });
  await mkdir('.generated', { recursive: true });
  const result = await Bun.build({
    entrypoints: ['./src/assets/docs.js'], outdir: './.generated', target: 'browser',
    minify: true, splitting: true, external: ['https://*'], naming: { entry: '[name].[ext]', chunk: 'chunk-[hash].[ext]', asset: '[name]-[hash].[ext]' }
  });
  if (!result.success) throw new AggregateError(result.logs, 'Docs assets failed to bundle');
}
