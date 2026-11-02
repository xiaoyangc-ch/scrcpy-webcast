import { defineConfig, UserConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import path from 'path'

export const alias = {
  common: path.resolve(__dirname, 'src/common'),
  share: path.resolve(__dirname, 'src/share'),
}

export default defineConfig((): UserConfig => {
  const pkg = JSON.parse(
    readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')
  )
  return {
    base: '',
    plugins: [react()],
    build: {
      outDir: 'dist/renderer',
      rollupOptions: {
        input: {
          app: './index.html',
        },
      },
    },
    css: {
      modules: {
        localsConvention: 'camelCaseOnly',
      },
      preprocessorOptions: {
        scss: {
          api: 'modern',
        },
      },
    },
    server: {
      hmr: false,
      port: 8080,
      // 端口被占时直接失败：dev.mjs 只认 8080，静默换端口会让它连到旧实例
      strictPort: true,
    },
    define: {
      PRODUCT_NAME: JSON.stringify(pkg.productName),
      VERSION: JSON.stringify(pkg.version),
    },
    resolve: {
      alias,
    },
  }
})
