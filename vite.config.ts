import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import mkcert from "vite-plugin-mkcert";
import { VitePWA } from "vite-plugin-pwa";
import fs from "fs";

/**
 * 🔄 Plugin personalizado: genera /version.json en cada build
 * con un hash único (timestamp). El VersionChecker del frontend
 * lo compara periódicamente y fuerza recarga si cambia.
 */
function versionPlugin(): Plugin {
  return {
    name: "version-generator",
    writeBundle() {
      const versionData = {
        version: Date.now().toString(36) + "-" + Math.random().toString(36).substring(2, 8),
        buildTime: new Date().toISOString(),
      };
      fs.writeFileSync(
        path.resolve(__dirname, "dist", "version.json"),
        JSON.stringify(versionData)
      );
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Configuración para Vercel (Ruta raíz)
  base: "/",
  
  build: {
    outDir: "dist",
    sourcemap: false,
    minify: "esbuild",
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  
  server: {
    host: "::",
    port: 8080,
    // ✅ HTTPS habilitado para desarrollo
    https: mode === "development",
  },
  plugins: [
    react(), 
    mode === "development" && componentTagger(),
    mode === "development" && mkcert(),
    
    // ✅ PWA - Ahora con autoUpdate AGRESIVO
    VitePWA({
      // 🔧 autoUpdate: el SW nuevo se instala y activa AUTOMÁTICAMENTE
      // sin pedirle nada al usuario
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "Lima Café 28 - Kiosco Escolar",
        short_name: "Lima Café 28",
        description: "Sistema de Gestión de Kiosco Escolar Lima Café 28",
        theme_color: "#3BAF9E",
        background_color: "#ffffff",
        display: "standalone",
        scope: "/",
        start_url: "/",
        orientation: "portrait-primary",
        lang: "es",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        // ✅ skipWaiting + clientsClaim: el SW nuevo toma control INMEDIATAMENTE
        skipWaiting: true,
        clientsClaim: true,
        // Cachear recursos estáticos
        globPatterns: ["**/*.{js,css,html,ico,svg,png,woff2}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // ❌ NO cachear version.json ni izipay-frame.html (van directo al servidor)
        // izipay-frame.html debe cargarse en su propio contexto limpio (popup aislado)
        navigateFallbackDenylist: [/^\/version\.json$/, /^\/izipay-frame\.html/],
        runtimeCaching: [
          {
            // ❌ version.json SIEMPRE NetworkOnly (nunca cachear)
            urlPattern: /\/version\.json$/,
            handler: "NetworkOnly",
          },
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "supabase-api-cache",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24,
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
    
    // ✅ Generar version.json en cada build
    versionPlugin(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
