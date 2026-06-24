// src/components/borrow/RecentActivity.tsx
"use client";

import * as React from "react";
import { ArrowDownLeft, ArrowUpRight, CreditCard } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TransactionKind = "repayment" | "borrow" | "deposit";

export interface Transaction {
  id: string;
  kind: TransactionKind;
  title: string;
  dateLabel: string;
  amountUsdc: number;
  /** true = money in (green), false = money out (red) */
  isCredit: boolean;
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_TRANSACTIONS: Transaction[] = [
  {
    id: "1",
    kind: "repayment",
    title: "Pago de cuota",
    dateLabel: "HOY, 10:30 AM",
    amountUsdc: 5.0,
    isCredit: true,
  },
  {
    id: "2",
    kind: "borrow",
    title: "Crédito tomado",
    dateLabel: "AYER, 4:15 PM",
    amountUsdc: 25.0,
    isCredit: false,
  },
  {
    id: "3",
    kind: "deposit",
    title: "Depósito recibido",
    dateLabel: "12 OCT, 2025",
    amountUsdc: 30.0,
    isCredit: true,
  },
];

// ---------------------------------------------------------------------------
// Icon map
// ---------------------------------------------------------------------------

function TransactionIcon({ kind }: { kind: TransactionKind }) {
  const base = "h-4 w-4";

  switch (kind) {
    case "repayment":
      return <ArrowUpRight className={`${base} text-emerald-600`} />;
    case "borrow":
      return <ArrowDownLeft className={`${base} text-red-500`} />;
    case "deposit":
      return <CreditCard className={`${base} text-primary`} />;
    default:
      return <CreditCard className={`${base} text-muted-foreground`} />;
  }
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function ActivityRow({ tx }: { tx: Transaction }) {
  const amountLabel = `${tx.isCredit ? "+" : "-"}${tx.amountUsdc.toFixed(2)} USDC`;

  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-border/30 last:border-b-0">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted/60">
          <TransactionIcon kind={tx.kind} />
        </div>

        <div className="min-w-0">
          <p className="text-[13px] font-medium leading-tight truncate">
            {tx.title}
          </p>
          <p className="mono-text mt-0.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {tx.dateLabel}
          </p>
        </div>
      </div>

      <span
        className={[
          "shrink-0 text-[13px] font-semibold tabular-nums",
          tx.isCredit ? "text-emerald-600" : "text-red-500",
        ].join(" ")}
      >
        {amountLabel}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RecentActivity
// ---------------------------------------------------------------------------

interface RecentActivityProps {
  /** Pass real transactions to override mock data */
  transactions?: Transaction[];
  onViewAll?: () => void;
}

export function RecentActivity({ transactions, onViewAll }: RecentActivityProps) {
  const items = transactions && transactions.length > 0 ? transactions : MOCK_TRANSACTIONS;

  return (
    <div className="mx-auto w-full max-w-md px-4 mb-4">
      {/* Section header */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-[13px] font-bold">Actividad reciente</p>
        <button
          type="button"
          onClick={onViewAll}
          className="text-[12px] font-medium text-primary hover:underline underline-offset-2"
        >
          Ver todo
        </button>
      </div>

      {/* Rows container */}
      <div className="rounded-2xl border border-border/40 bg-card px-4">
        {items.map((tx) => (
          <ActivityRow key={tx.id} tx={tx} />
        ))}
      </div>
    </div>
  );
}

export default RecentActivity;
