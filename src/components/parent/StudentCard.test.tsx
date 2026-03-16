/**
 * QA automatizado — StudentCard
 * Ejecutar: npx vitest run src/components/parent/StudentCard.test.tsx
 *
 * Prerrequisito (primera vez):
 *   npm install -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom
 *   Y añadir en vite.config.ts dentro de defineConfig:
 *     test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test-setup.ts'] }
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { StudentCard } from './StudentCard';

// ─── Mock de supabase para que no llame a la red ─────────────────────────────
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              neq: () => ({
                gte: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
        }),
      }),
    }),
  },
}));

// ─── Alumno base (reutilizable) ───────────────────────────────────────────────
const baseStudent = {
  id: 'test-id',
  full_name: 'Alumno Test',
  photo_url: null,
  balance: 0,
  daily_limit: 0,
  weekly_limit: 0,
  monthly_limit: 0,
  limit_type: 'none',
  grade: '3°',
  section: 'A',
  is_active: true,
  free_account: true,
  kiosk_disabled: false,
  school: { id: 'school-1', name: 'Colegio Test' },
};

const noopFn = () => {};

// ─── Helper para renderizar ────────────────────────────────────────────────────
function renderCard(overrides: Partial<typeof baseStudent> = {}, debtProps: {
  totalDebt?: number; lunchDebt?: number; kioskDebt?: number;
} = {}) {
  const student = { ...baseStudent, ...overrides };
  render(
    <StudentCard
      student={student}
      totalDebt={debtProps.totalDebt ?? 0}
      lunchDebt={debtProps.lunchDebt ?? 0}
      kioskDebt={debtProps.kioskDebt ?? 0}
      pendingRechargeAmount={0}
      onRecharge={noopFn}
      onViewHistory={noopFn}
      onViewMenu={noopFn}
      onOpenSettings={noopFn}
      onPhotoClick={noopFn}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ESCENARIO 1 — Solo deuda almuerzo (S/ 14.50), kiosco S/ 0
// ─────────────────────────────────────────────────────────────────────────────
describe('ESCENARIO 1 — Solo deuda almuerzo', () => {
  beforeEach(() => {
    renderCard(
      { balance: 0, free_account: true },
      { lunchDebt: 14.50, kioskDebt: 0, totalDebt: 14.50 }
    );
  });

  it('muestra "Deuda Almuerzos" (NO "Deuda Kiosco" ni "Deuda Total")', () => {
    expect(screen.getByText(/deuda almuerzos/i)).toBeInTheDocument();
    expect(screen.queryByText(/deuda kiosco/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/deuda total/i)).not.toBeInTheDocument();
  });

  it('muestra el monto S/ 14.50', () => {
    expect(screen.getByText('S/ 14.50')).toBeInTheDocument();
  });

  it('tiene franja roja en la tarjeta', () => {
    const accentBar = document.querySelector('.bg-red-400');
    expect(accentBar).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ESCENARIO 2 — Solo deuda kiosco (S/ 10, cuenta prepago con balance negativo)
// ─────────────────────────────────────────────────────────────────────────────
describe('ESCENARIO 2 — Solo deuda kiosco', () => {
  beforeEach(() => {
    renderCard(
      { balance: -10, free_account: false },
      { lunchDebt: 0, kioskDebt: 10, totalDebt: 10 }
    );
  });

  it('muestra "Deuda Kiosco" (NO "Deuda Almuerzos" ni "Deuda Total")', () => {
    expect(screen.getByText(/deuda kiosco/i)).toBeInTheDocument();
    expect(screen.queryByText(/deuda almuerzos/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/deuda total/i)).not.toBeInTheDocument();
  });

  it('muestra el monto S/ 10.00', () => {
    expect(screen.getByText('S/ 10.00')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ESCENARIO 3 — Ambas deudas (S/ 14.50 almuerzo + S/ 10.00 kiosco)
// ─────────────────────────────────────────────────────────────────────────────
describe('ESCENARIO 3 — Ambas deudas', () => {
  beforeEach(() => {
    renderCard(
      { balance: -10, free_account: false },
      { lunchDebt: 14.50, kioskDebt: 10, totalDebt: 24.50 }
    );
  });

  it('muestra "Deuda Total" cuando hay ambas deudas', () => {
    expect(screen.getByText(/deuda total/i)).toBeInTheDocument();
  });

  it('muestra el total combinado S/ 24.50', () => {
    expect(screen.getByText('S/ 24.50')).toBeInTheDocument();
  });

  it('el desglose separado aparece al expandir (texto "Ver desglose" visible)', () => {
    expect(screen.getByText(/ver desglose/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ESCENARIO 4 — Sin deudas, saldo S/ 20
// ─────────────────────────────────────────────────────────────────────────────
describe('ESCENARIO 4 — Sin deudas, saldo positivo', () => {
  beforeEach(() => {
    renderCard(
      { balance: 20, free_account: false },
      { lunchDebt: 0, kioskDebt: 0, totalDebt: 0 }
    );
  });

  it('NO muestra ninguna franja roja', () => {
    const accentBar = document.querySelector('.bg-red-400');
    expect(accentBar).not.toBeInTheDocument();
  });

  it('NO muestra "Deuda" de ningún tipo', () => {
    expect(screen.queryByText(/deuda/i)).not.toBeInTheDocument();
  });

  it('muestra "Saldo Kiosco" o "Al día"', () => {
    const tieneLabel =
      screen.queryByText(/saldo kiosco/i) !== null ||
      screen.queryByText(/al día/i) !== null;
    expect(tieneLabel).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGLA DE ORO: El botón "Hacer Pedido" NUNCA es parte de StudentCard
// (es una sub-pestaña en Index.tsx — se confirma que no hay botón bloqueado)
// ─────────────────────────────────────────────────────────────────────────────
describe('Regla de Oro — almuerzos independientes del saldo', () => {
  it('StudentCard no contiene ningún botón "Hacer Pedido"', () => {
    renderCard(
      { balance: -50, free_account: false },
      { lunchDebt: 100, kioskDebt: 50, totalDebt: 150 }
    );
    expect(screen.queryByText(/hacer pedido/i)).not.toBeInTheDocument();
  });

  it('kiosk_disabled NO bloquea el texto de almuerzos en la tarjeta', () => {
    renderCard({ kiosk_disabled: true }, {});
    expect(screen.getByText(/solo almuerzo/i)).toBeInTheDocument();
  });
});
