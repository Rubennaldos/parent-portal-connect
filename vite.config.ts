import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import mkcert from "vite-plugin-mkcert";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Configuración para Vercel (Ruta raíz)
  base: "/",
  
  build: {
    outDir: "dist",
    sourcemap: false,
    minify: "esbuild", // Cambiado de terser a esbuild (viene por defecto)
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
    // Esto resuelve el problema de QZ Tray pidiendo permiso constantemente
    https: mode === "development",
  },
  plugins: [
    react(), 
    mode === "development" && componentTagger(),
    // ✅ Plugin para generar certificados SSL válidos en localhost
    mode === "development" && mkcert(),
    // ✅ PWA - Permite instalar la app en celulares
    VitePWA({
      // 🔧 FIX: "prompt" en vez de "autoUpdate" para evitar que la página
      // se recargue sola al volver a la pestaña cuando hay una actualización
      registerType: "prompt",
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
        // Cachear recursos estáticos para uso offline
        globPatterns: ["**/*.{js,css,html,ico,svg,png,woff2}"],
        // El bundle principal pesa >2MB, aumentamos el límite a 5MB
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "supabase-api-cache",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24, // 1 día
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: false, // Solo activo en producción
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
