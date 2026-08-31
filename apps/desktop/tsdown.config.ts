import { defineConfig } from 'tsdown'

/**
 * The desktop app ships two main-process entries: the Electron main (the
 * `main` package.json points at) and the preload the BrowserWindow loads.
 * The renderer dist is the separate vite build; declarations come from
 * `tsc -b` (dts: false), matching every package. The app declares no browser
 * bundle, so the Client build pass skips it.
 */
export default defineConfig(({ env }) => {
  if (env?.DSH_BUILD_FACE === 'client') return [{ entry: '' }]
  return {
    entry: ['lib/types/main.js', 'lib/types/preload.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    // Electron supplies this ESM module to the main and preload contexts.
    // Bundling the devDependency rewrites it to a CommonJS require shim that
    // cannot initialize from the packaged ESM entry.
    deps: { neverBundle: ['electron'] },
  }
})
