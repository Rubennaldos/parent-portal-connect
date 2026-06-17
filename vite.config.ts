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
        // skipWaiting + clientsClaim: el SW nuevo toma control inmediatamente.
        skipWaiting: true,
        clientsClaim: true,
        // Precachear SOLO assets estáticos con hash (JS, CSS, fuentes, imágenes).
        // El hash en el nombre del archivo garantiza que siempre son frescos.
        globPatterns: ["**/*.{js,css,ico,svg,png,woff2}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // index.html y manifest no tienen hash → nunca pre-caché.
        navigateFallbackDenylist: [/^\/version\.json$/, /^\/izipay-frame\.html/],
        runtimeCaching: [
          {
            // version.json → siempre desde la red. Usado por VersionChecker.
            urlPattern: /\/version\.json$/,
            handler: "NetworkOnly",
          },
          {
            // TODA la API REST de Supabase → siempre desde la red, sin excepción.
            // Incluye: /rest/v1/*, /storage/v1/*, /auth/v1/*, /functions/v1/* (RPC).
            // Razón: datos financieros y de almuerzos no pueden servirse desde caché.
            // Si la red no responde, el error debe llegar al usuario, no una respuesta
            // obsoleta de 24h que le haría ver pedidos incorrectos o saldos viejos.
            urlPattern: /\.supabase\.co\//i,
            handler: "NetworkOnly",
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
