import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// BufferX ships two ways from one build:
//   - `pnpm dev` / `pnpm build`  -> plain static web app
//   - wrapped by Tauri          -> same bundle inside a native webview
// Nothing here may assume the Tauri runtime exists; host capabilities are
// probed at runtime instead (see src/engine/host.ts).
export default defineConfig(({ mode }) => ({
  // The hosted build lives behind the subscription gateway at /bufferx/.
  // Desktop and ordinary local builds keep their root-relative layout.
  base: mode === 'hosted' ? '/bufferx/' : '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    // pnpm's nested node_modules lets a dependency resolve its own React while
    // app code resolves the hoisted one. Two React instances means two hook
    // dispatchers, and every hook in the second one throws "Invalid hook call".
    dedupe: ['react', 'react-dom'],
  },
  // Tauri expects a fixed port and surfaces build errors rather than masking them.
  clearScreen: false,
  server: {
    // The builder uses the same source XML embedded into the native engine.
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    // Everything this project generates lands under `build/`: CMake in
    // build/cmake, Rust in build/rust, the web bundle here. `emptyOutDir` is
    // explicit because the directory sits outside the Vite root, where Vite
    // otherwise refuses to clear it.
    outDir: '../build/web',
    emptyOutDir: true,
    target: 'es2022',
    // 'hidden' emits the maps but writes no //# sourceMappingURL comment, so a
    // deployed build does not hand out readable sources — BufferX is licensed
    // proprietary — while the maps are still there locally to symbolicate a
    // stack trace. The dev server serves its own maps regardless of this.
    sourcemap: mode === 'hosted' ? false : 'hidden',
    rollupOptions: {
      output: {
        manualChunks: {
          codemirror: ['@codemirror/state', '@codemirror/view', '@codemirror/language'],
          vendor: ['react', 'react-dom'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
}))
