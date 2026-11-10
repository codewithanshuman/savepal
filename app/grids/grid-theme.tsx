"use client";
/*
 * The shared foundation of SavePal's tables: AG Grid Community with only the modules the tables
 * use (no Enterprise features), a theme drawn from the dashboard's own tokens, read-only column
 * defaults, the status pills every table shares, and a hook for phone-width layouts. Tables are
 * client-only and loaded on demand, so the rest of the workspace never waits on the grid.
 */
import { useSyncExternalStore } from "react";
import {
  CellStyleModule, ClientSideRowModelModule, GridStateModule, NumberFilterModule, PaginationModule,
  QuickFilterModule, RowApiModule, RowSelectionModule, RowStyleModule, TextFilterModule, TooltipModule, ValidationModule, themeQuartz,
  type ColDef, type Module,
} from "ag-grid-community";

export const GRID_MODULES: Module[] = [
  ClientSideRowModelModule, TextFilterModule, NumberFilterModule, QuickFilterModule, PaginationModule,
  RowApiModule, RowSelectionModule, RowStyleModule, CellStyleModule, TooltipModule, GridStateModule,
  // explains a missing module or a bad option in development; left out of production builds
  ...(process.env.NODE_ENV !== "production" ? [ValidationModule] : []),
];

export const gridTheme = themeQuartz.withParams({
  accentColor: "#0070e0",
  backgroundColor: "#ffffff",
  foregroundColor: "#0b1b36",
  textColor: "#0b1b36",
  borderColor: "#e7ecf3",
  headerBackgroundColor: "#f5f7fb",
  headerTextColor: "#4b5a73",
  rowHoverColor: "#f3f8ff",
  selectedRowBackgroundColor: "#eaf2ff",
  oddRowBackgroundColor: "#fcfdff",
  fontFamily: "inherit",
  fontSize: 13,
  headerFontSize: 12,
  headerFontWeight: 600,
  wrapperBorderRadius: 14,
  borderRadius: 8,
  spacing: 7,
  rowHeight: 46,
  headerHeight: 40,
  cellHorizontalPadding: 14,
});

/** Every column: sortable and resizable, never editable -- these tables explain records, they do not change them. */
export const READ_ONLY: ColDef = { sortable: true, resizable: true, editable: false, suppressMovable: true };

export type Tone = "ok" | "bad" | "warn" | "pp" | "mute";
/** A small coloured status label, shared by every table and detail panel. */
export function Pill({ tone, children, title }: { tone: Tone; children: React.ReactNode; title?: string }) {
  return <span className={`g-pill g-${tone}`} title={title}>{children}</span>;
}

const narrowQuery = "(max-width: 760px)";
/** True on phone-width screens, where tables show their essential columns and the detail panel the rest. */
export function useNarrow(): boolean {
  return useSyncExternalStore(
    (fn) => { const m = window.matchMedia(narrowQuery); m.addEventListener("change", fn); return () => m.removeEventListener("change", fn); },
    () => window.matchMedia(narrowQuery).matches,
    () => false,
  );
}

const money = (cents: number, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
const when = (value: string | null) => value ? new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
export { money, when };
