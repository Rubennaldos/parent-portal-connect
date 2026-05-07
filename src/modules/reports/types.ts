import type { ReactNode } from 'react';

/**
 * ISO date string in YYYY-MM-DD format (e.g. "2026-05-03").
 * Branded so TypeScript rejects plain strings at assignment boundaries.
 */
export type ISODateString = string & { readonly __isoDate: unique symbol };

/**
 * Supabase UUID identifying a school row.
 * Branded to prevent mixing with other UUID-shaped strings.
 */
export type SchoolId = string & { readonly __schoolId: unique symbol };

export interface ReportDateRange {
  from: ISODateString;
  to: ISODateString;
}

export interface ReportSchoolOption {
  id: SchoolId;
  name: string;
}

export interface ReportFilters {
  dateRange: ReportDateRange;
  /** Value shown in the UI selector: 'all' or a SchoolId. */
  selectedSchoolId: SchoolId | 'all';
  /**
   * The school ID actually applied to DB queries.
   * null  → admin selected "Todas las sedes".
   * value → single school (admin filtered, or non-admin locked).
   * The frontend never trusts this for access control; RPCs enforce RLS.
   */
  effectiveSchoolId: SchoolId | null;
  canViewAllSchools: boolean;
}

export interface BaseReportViewProps {
  title: string;
  description?: string;
  className?: string;
  children?: ReactNode | ((filters: ReportFilters) => ReactNode);
  renderContent?: (filters: ReportFilters) => ReactNode;
  onFiltersChange?: (filters: ReportFilters) => void;
}

export interface ReportRegistryItem {
  id: string;
  title: string;
  description?: string;
  requiredRoles: string[];
  component: (props: { filters: ReportFilters }) => ReactNode;
}
