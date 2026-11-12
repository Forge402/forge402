import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// Home only: start fetching the hero poster and the three.js chunks from <head>, before the entry bundle has even run.
function heroPreload(): Plugin {
  return {
    name: 'forge-hero-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const files = Object.values(ctx.bundle ?? {})
          .filter((c) => c.type === 'chunk' && (c.name === 'three' || c.name === 'scene' || c.name === 'forge-hero-3d'))
          .map((c) => `/${c.fileName}`)
        const js =
          `if(location.pathname==='/'){var h=document.head,a=function(r,u,m){var l=document.createElement('link');l.rel=r;l.href=u;if(r==='preload'){l.as='image';l.fetchPriority='high';l.media=m}h.appendChild(l)};` +
          `a('preload','/assets/hero-poster.webp','(min-width:560px)');a('preload','/assets/hero-poster-compact.webp','(max-width:559px)');` +
          `${JSON.stringify(files)}.forEach(function(u){a('modulepreload',u)})}`
        return [{ tag: 'script', children: js, injectTo: 'head-prepend' }]
      },
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), heroPreload()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  // the model catalog lives one level up in forge402/data
  server: { fs: { allow: ['..'] } },
  build: {
    // three.js in its own long-cacheable chunk, separate from our scene code
    rolldownOptions: {
      output: { codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }] } },
    },
  },
})
