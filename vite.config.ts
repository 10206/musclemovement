import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// ---------------------------------------------------------------------------
// GitHub Pages project-site path
// ---------------------------------------------------------------------------
// GitHub Pages serves a project site (as opposed to a user/org `*.github.io`
// site) from https://<username>.github.io/<repo>/ — everything is nested
// under a `/<repo>/` subpath. `REPO_NAME` below is the ONLY thing that needs
// to change if this repository is ever renamed; the GitHub *username* does
// not appear here at all (Pages deploys under whatever account/org owns the
// repo, so nothing here is username-specific — see README.md's "GitHub 계정"
// section for the one place the username itself needs to be written down).
//
// This constant drives three things that all MUST agree, or PWA install
// fails silently on iOS (ARCHITECTURE.md §0):
//   1. Vite's `base` — every built asset URL is prefixed with this path.
//   2. The web app manifest's `start_url` / `scope`.
//   3. The service worker's registration scope (vite-plugin-pwa derives this
//      from Vite's `base` automatically, see below).
const REPO_NAME = 'musclemovement'
const BASE_PATH = `/${REPO_NAME}/`

// https://vite.dev/config/
export default defineConfig({
  // MUST match the GitHub repository name exactly (see ARCHITECTURE.md §0) —
  // a mismatch here is the classic cause of a blank page / 404s after deploy.
  base: BASE_PATH,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // vite-plugin-pwa defaults `manifest.start_url`/`scope` to Vite's
      // `base` and registers the SW at that same scope already — they're
      // repeated explicitly here because a misaligned scope/start_url is
      // *the* iOS PWA install failure mode this app has to avoid.
      base: BASE_PATH,
      scope: BASE_PATH,
      // No `includeAssets` needed: the `workbox.globPatterns` below already
      // matches every file under public/ (favicon.svg, icons/*) recursively.
      // `includeManifestIcons: false` avoids double-listing manifest icons
      // in the precache manifest (globPatterns already covers them).
      includeManifestIcons: false,
      manifest: {
        name: '근육 움직임 3D 해부',
        short_name: '근육움직임',
        description: '운동 시 근육의 움직임을 3D 해부상으로 확인하는 웹앱',
        lang: 'ko',
        start_url: BASE_PATH,
        scope: BASE_PATH,
        display: 'standalone',
        orientation: 'portrait',
        // White to match Stage.tsx's canvas background (see ARCHITECTURE.md
        // §0) — the splash screen / status bar chrome should read as a
        // seamless continuation of the app, not a jarring border.
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Default glob set (js/css/html/svg/png/ico/woff2) covers the app
        // shell. The 3D model assets are handled separately below — they
        // aren't eagerly precached as part of the app shell install, they're
        // cached the first time they're actually fetched (see runtimeCaching).
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Workbox's precache step silently *skips* (not errors) any file
        // over this cap — default is 2MB. The real anatomy model
        // (public/models/anatomy.glb, not yet added — see README.md's
        // licence-attribution placeholder) will be tens of MB, and KTX2
        // textures can approach it too, so this is raised well past that.
        maximumFileSizeToCacheInBytes: 100 * 1024 * 1024, // 100 MB
        runtimeCaching: [
          {
            // .glb/.gltf/.ktx2/.bin: the 3D model + compressed textures +
            // binary buffers. CacheFirst = fetch once over the network,
            // then always serve from the SW cache — right call for large,
            // content-addressed-in-practice assets that don't change once
            // shipped, and it means they don't block SW install like an
            // eager precache entry would on a cellular connection.
            urlPattern: ({ url }) => /\.(?:glb|gltf|ktx2|bin)$/i.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'model-assets',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year — see registerType: autoUpdate for busting
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        // Off by default: `vite dev` already serves everything from '/'
        // (no base-path subtlety to catch), and a dev-mode SW makes local
        // debugging of caching behavior more confusing than useful. Flip to
        // `true` only when specifically testing SW/offline behavior.
        enabled: false,
      },
    }),
  ],
})
