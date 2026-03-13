import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**", "**/.claude/**"],
    },
  },
  build: {
    // Perf: use esbuild minification (faster than terser, good results)
    minify: "esbuild",
    target: "esnext",
    rollupOptions: {
      output: {
        // Perf: split Three.js into its own chunk for better caching.
        // Three.js rarely changes between deploys, so browsers can cache it
        // independently of app code.
        manualChunks: {
          three: ["three", "three/addons/loaders/GLTFLoader.js"],
          vrm: ["@pixiv/three-vrm"],
        },
      },
    },
    // Perf: tree-shaking hints — mark side-effect-free modules
    commonjsOptions: {
      // Ensure proper tree-shaking of CJS modules
      transformMixedEsModules: true,
    },
  },
  // Perf: optimize Three.js dependency pre-bundling
  optimizeDeps: {
    include: ["three", "@pixiv/three-vrm"],
  },
});
