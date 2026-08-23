import react from '@vitejs/plugin-react'
import path from 'path'

export default {
    plugins: [react()],
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
