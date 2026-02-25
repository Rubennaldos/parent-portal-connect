# AGENTS.md

## Cursor Cloud specific instructions

### Overview

**Lima Café 28** is a school cafeteria management SaaS (React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui). The backend is entirely Supabase (hosted PostgreSQL, Auth, Edge Functions, RLS). There is no local backend service to run.

### Running the dev server

```bash
npm run dev
```

Vite serves at `https://localhost:8080/` (HTTPS enabled via `vite-plugin-mkcert`). Certificates are auto-generated in `~/.vite-plugin-mkcert/`.

### Linting and building

- **Lint**: `npm run lint` (ESLint; pre-existing warnings/errors in the codebase are expected)
- **Build**: `npm run build`
- **TypeScript check**: `npx tsc --noEmit`

### Environment variables

Copy `.env.example` to `.env` and fill in the Supabase credentials. The app reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. If these are not set, the app falls back to hardcoded values in `src/config/supabase.config.ts` (production config for non-localhost, placeholder for localhost). For local development, the `.env` file must have valid Supabase credentials.

### Key caveats

- The Vite config enables HTTPS in development mode (for QZ Tray thermal printer integration). The `vite-plugin-mkcert` handles certificate generation automatically, no manual `mkcert` installation required.
- The app gracefully handles missing Supabase credentials (`isAuthConfigured` flag in `src/lib/supabase.ts`), so the UI will render even without a valid Supabase connection, but auth and data features will be unavailable.
- No automated test suite exists in the repository. There is no `test` script in `package.json`.
- The project uses npm (lockfile: `package-lock.json`).
