// vite.config.ts
/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

function clientLogPlugin(): Plugin {
  const mount = (server: { middlewares: { use: (path: string, handler: (req: import('http').IncomingMessage, res: import('http').ServerResponse) => void) => void } }, label: 'dev' | 'preview') => {
    console.log(`[client-log] plugin cargado (${label})`)
    server.middlewares.use('/__client-log', (req, res) => {
      if (req.method !== 'POST') { res.statusCode = 405; return res.end() }
      let body = ''
      req.on('data', (c: Buffer) => (body += c))
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}')
          const { level = 'log', msg = '', stack, tag, path, ua, time } = data
          const ts = time ? new Date(time).toISOString() : new Date().toISOString()
          const line = `[${ts}] [client ${level}]${tag ? ` [${tag}]` : ''} ${msg}`
          const fn =
            level === 'error' ? console.error :
            level === 'warn'  ? console.warn  :
            console.log
          fn(line)
          if (stack) console.log(stack)
          if (path || ua) console.log(`path=${path ?? ''} ua=${ua ?? ''}`)
        } catch (e) {
          console.error('[client-log] bad JSON', e)
        }
        res.statusCode = 204; res.end()
      })
    })
  }

  return {
    name: 'client-log-endpoint',
    configureServer(server) { mount(server, 'dev') },
    configurePreviewServer(server) { mount(server, 'preview') },
  }
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    clientLogPlugin(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
      '@stellar/stellar-sdk/contract': path.resolve(
        __dirname,
        './node_modules/@stellar/stellar-sdk/lib/esm/contract/index.js',
      ),
      '@stellar/stellar-sdk/rpc': path.resolve(
        __dirname,
        './node_modules/@stellar/stellar-sdk/lib/esm/rpc/index.js',
      ),
      '@stellar/stellar-sdk': path.resolve(
        __dirname,
        './node_modules/@stellar/stellar-sdk/lib/esm/index.js',
      ),
      buffer: path.resolve(__dirname, './node_modules/buffer/index.js'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: ['lendoor.xyz', 'staging.lendoor.xyz', '.devtunnels.ms', '.trycloudflare.com', '.ngrok-free.app', '.ngrok.app', '.loca.lt'],
    // Spec 082 (dev only): proxy del backend bajo el MISMO origen que el
    // frontend, así un único tunnel/dominio fijo expone ambos. El frontend
    // usa VITE_PUBLIC_BACKEND_URL=/__api (ver .env.local) → vite reescribe
    // /__api/user/... → http://localhost:5000/user/...
    proxy: {
      '/__api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/__api/, ''),
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: ['lendoor.xyz', 'staging.lendoor.xyz'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
