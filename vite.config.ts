import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import mkcert from "vite-plugin-mkcert";

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
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
