import react from '@vitejs/plugin-react'
import vitePluginCompress from 'vite-plugin-compression'
import path from 'path'; // Importing path module

// const isCodeSandbox = 'SANDBOX_URL' in process.env || 'CODESANDBOX_HOST' in process.env

export default {
    plugins: [
        react(),
        vitePluginCompress(),
    ],
    root: 'src/',
    publicDir: "../public/",
    base: './',
    resolve: {
    alias: {
      'three-stdlib': path.resolve(__dirname, 'node_modules/three-stdlib')
    }
  },
    build: {
        outDir: '../docs',
        emptyOutDir: true,
        sourcemap: false
    }
}
