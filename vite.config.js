import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'
import { fileURLToPath } from 'node:url'

// ez-tree's textures.js loads every bark + leaf texture (~3 MB) as soon as it is imported.
// Point its `./textures` import at a shim that only loads the textures a tree actually uses.
function ezTreeLazyTextures() {
  const shim = fileURLToPath(new URL('./src/scene/ezTreeTextures.js', import.meta.url))
  return {
    name: 'ez-tree-lazy-textures',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === './textures' && importer?.includes('/@dgreenheck/ez-tree/src/lib/')) return shim
    },
  }
}

export default defineConfig({
  // cloudflare(): runs worker/index.js (D1, R2, /api) inside the Vite dev server and builds it.
  plugins: [react(), ezTreeLazyTextures(), cloudflare()],
  resolve: {
    // Use ez-tree's ES source (not the 4 MB build with base64-inlined textures). Its package
    // `exports` only exposes the build, so alias the source folder by path.
    alias: { 'ez-tree-src': fileURLToPath(new URL('./node_modules/@dgreenheck/ez-tree/src/lib', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          r3f: ['@react-three/fiber', '@react-three/drei'],
          postprocessing: ['postprocessing', '@react-three/postprocessing'],
        },
      },
    },
  },
})
