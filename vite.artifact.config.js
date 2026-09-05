import react from "@vitejs/plugin-react";
import path from "path";

// One-file build used to publish the game as a self-contained page
// (claude.ai artifact preview): every asset inlined, single JS chunk.
export default {
  plugins: [react()],
  define: {
    __BUILD_ID__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')),
  },
  root: "src/",
  publicDir: "../public/",
  base: "./",
  resolve: {
    alias: {
      "three-stdlib": path.resolve(__dirname, "node_modules/three-stdlib"),
    },
  },
  build: {
    outDir: "../artifact-dist",
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
};
