import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { config as loadDotenv } from 'dotenv';
import { visualizer } from 'rollup-plugin-visualizer';

// Honor WEB_PORT + API_PROXY_TARGET env vars so the E2E suite can spin a
// dedicated web on :6000 proxying to api on :6001 alongside any dev
// :4000/:4001 instance. Defaults preserved for the standard dev flow.
//
// ATLAS_ENV=prod picks .env.prod (web on 5000, proxy to api on 5001).
// Otherwise reads .env (dev defaults). Mirrors packages/api/src/load-env.ts
// so vite's WEB_PORT / API_PROXY_TARGET come from the same source of truth
// as the API's DATABASE_URL / API_PORT.
const isProd = process.env.ATLAS_ENV?.toLowerCase() === 'prod';
const envFile = isProd ? '.env.prod' : '.env';
loadDotenv({ path: path.resolve(__dirname, '..', '..', envFile) });

// Prefer WEB_PORT so dev/prod/E2E never fight over a shared PORT var. Fall
// back to PORT for tools that only set the generic var.
const WEB_PORT = Number(process.env.WEB_PORT ?? process.env.PORT) || 4000;
const API_TARGET = process.env.API_PROXY_TARGET || 'http://127.0.0.1:4001';

// Audit 2026-06-09 — bundle visualizer behind `--mode analyze`.
// `pnpm -F @atlas/web build --mode analyze` writes `dist/stats.html`
// (gzip + brotli sizes per chunk) for inspecting bundle composition
// without changing the standard build output. Default mode never
// emits the report and never bundles the plugin.
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ...(mode === 'analyze'
      ? [
          visualizer({
            filename: 'dist/stats.html',
            template: 'treemap',
            gzipSize: true,
            brotliSize: true,
            open: false,
          }),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: WEB_PORT,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        // 2026-06-22 — Terminal v1. /api/cli/sessions/:id/stream is a
        // WebSocket; http-proxy-middleware needs `ws: true` to pass the
        // Upgrade handshake through to the API process.
        ws: true,
      },
    },
  },
  // Mirror of `server.proxy` for `vite preview` so the production-style
  // local serve (used by `pnpm start` at the repo root) reaches the API
  // without the browser tripping CORS preflight.
  preview: {
    port: WEB_PORT,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    target: 'es2022',
    // Don't ship sourcemaps to the production bundle — they leak source
    // paths and roughly double the artifact size. Pages are already
    // code-split via `lazyNamed`, so manualChunks just pulls the largest
    // shared deps into stable chunks the browser can long-cache.
    sourcemap: false,
    rollupOptions: {
      output: {
        // react-router-dom is intentionally NOT split into its own chunk —
        // it cycles with @mui through composed `Link` usage, which made
        // rollup emit `Circular chunk: router -> mui -> router` on every
        // build. ~15 KiB gz in the main bundle is cheaper than the
        // warning + the marginal cache benefit. @tanstack/react-query
        // and @mui stay split because each is large enough to long-cache
        // on its own and neither cycles.
        //
        // recharts is used ONLY by the Analytics page (~127 KB gz), but
        // pulling it out of the page chunk means a code change to
        // Analytics.tsx no longer busts the recharts cache. Combined
        // with the route-level `lazy(...)` boundary, first /analytics
        // visit pays the recharts cost once and every subsequent visit
        // (including post-deploy ones where only Analytics.tsx changed)
        // comes from disk cache.
        //
        // `react-vendor` MUST be split out explicitly AND must capture
        // every React-flavoured module — `react`, `react-dom`,
        // `react/jsx-runtime`, `scheduler`, every `react-is` major. A
        // string-list manualChunk (`['react','react-dom']`) only catches
        // the main entries; deep paths like `react/jsx-runtime` stay
        // wherever rollup hoisted them. When `react/jsx-runtime`
        // (which carries `exports.Activity = ...` in React 19's CJS)
        // ends up in the `mui` chunk, the `recharts` chunk imports
        // React from it, mui starts importing back from recharts to
        // grab shared transitive deps, and the resulting cyclic chunk
        // graph throws `Cannot set properties of undefined (setting
        // 'Activity')` at load time. Catching everything by id keeps
        // react-vendor dependency-free and resolves the cycle.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (/[\\/](?:react|react-dom|scheduler|react-is)@/.test(id)) {
              return 'react-vendor';
            }
            // Split MUI into 4 buckets so each page only pays for the
            // surface it actually uses. Check icons and form/feedback FIRST,
            // then fall through to mui-core for everything else in @mui.
            //
            // NOTE: Vite resolves deep @mui/material/* imports via the
            // package.json `exports` field to `./esm/<Component>/…` (ESM
            // condition). The module IDs therefore contain `/esm/` between
            // the package root and the component folder. Match using a regex
            // that accepts both the direct path and the esm sub-path so the
            // rules stay future-proof if MUI restructures its exports.
            if (id.includes('@mui/icons-material')) return 'mui-icons';
            if (
              /\/@mui\/material(?:\/esm)?\/(?:TextField|Select|MenuItem|Autocomplete|Checkbox|Radio(?:Group)?|Switch|FormControl|InputLabel|FormHelperText|FormGroup|FormControlLabel|Slider)/.test(id)
            ) return 'mui-form';
            if (
              /\/@mui\/material(?:\/esm)?\/(?:Dialog(?:Actions|Content|ContentText|Title)?|Modal|Drawer|Snackbar|Alert(?:Title)?|Tooltip|Popover|Popper|Backdrop|CircularProgress|LinearProgress|Skeleton)/.test(id)
            ) return 'mui-feedback';
            if (id.includes('@mui')) return 'mui-core';
            if (id.includes('@tanstack/react-query')) return 'query';
            if (id.includes('recharts')) return 'recharts';
          }
        },
      },
    },
  },
  // Pre-bundle the heavy app-wide deps so dev mode does not serve them
  // module-by-module on first paint. Each entry below is consumed across
  // most pages; before this list existed, the browser fetched ~200 small
  // ESM files for these libs before any API call could fire, pushing
  // DOMContentLoaded out to ~1 s on a cold reload.
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react-router-dom',
      '@tanstack/react-query',
      '@mui/material',
      '@mui/material/styles',
      '@mui/icons-material',
    ],
  },
}));
