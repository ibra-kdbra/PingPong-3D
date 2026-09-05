import react from '@vitejs/plugin-react'
import path from 'path'

export default {
    plugins: [react()],
  define: {
    __BUILD_ID__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')),
  },
    define: {
        __BUILD_ID__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' '))
    },
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
