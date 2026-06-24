// src/app/.../DebtorsPage.tsx
"use client";

import * as React from "react";
import { formatUnits, parseUnits } from "ethers";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";

// USDC usa 6 decimales
const DECIMALS = 6;

function USDCIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#2775CA" />
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="white" strokeWidth="1.6" opacity="0.6" />
      <path
        d="M12 7.8c-1.7 0-3 .9-3 2.3 0 1.3 1 1.9 2.6 2.2l.7.1c1.1.2 1.8.5 1.8 1.2 0 .8-.8 1.3-2 1.3-1.1 0-2.1-.4-2.8-.9m2.7-6.2v1.2m0 7.1v1.2"
        fill="none"
        stroke="white"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Types
type Debtor = { address: string; debtRaw: bigint; inDefault?: boolean };

// Demo data
const HARDCODED_DEBTORS: Debtor[] = [
  { address: "0xA8f4C1eA5B5a6B7c8D9e0F1a2B3c4D5e6F708901", debtRaw: parseUnits("40.50", DECIMALS), inDefault: true },
  { address: "0xB239142fF02D48A9eb0c06d28866A4dDeDc89867", debtRaw: parseUnits("15.00", DECIMALS) },
  { address: "0xC7d9e2F3a4B5C6D7e8F9012a34b56789cDEF0123", debtRaw: parseUnits("9.99", DECIMALS) },
  { address: "0xD1E2f3A4B5c6D7e8f9A0b1c2D3E4f5A6B7C8D9E0", debtRaw: parseUnits("20", DECIMALS) },
  { address: "0x1111222233334444555566667777888899990000", debtRaw: parseUnits("25.12", DECIMALS) },
];

// Helpers
const shorten = (addr: string, head = 6, tail = 4) => `${addr.slice(0, head)}…${addr.slice(-tail)}`;

const fmtUSDC = (raw: bigint) => {
  const s = formatUnits(raw, DECIMALS);
  const [int, dec = ""] = s.split(".");
  const intFmt = new Intl.NumberFormat("en-US").format(Number(int));
  return dec ? `${intFmt}.${dec}` : intFmt;
};

export default function DebtorsPage() {
  const { t } = useTranslation();

  const [query, setQuery] = React.useState("");
  const [sortDesc, setSortDesc] = React.useState(true);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = HARDCODED_DEBTORS.filter((d) => !q || d.address.toLowerCase().includes(q));
    const defaults = matches.filter((d) => d.inDefault);
    const others = matches.filter((d) => !d.inDefault);
    others.sort((a, b) => (sortDesc ? (b.debtRaw > a.debtRaw ? 1 : -1) : (a.debtRaw > b.debtRaw ? 1 : -1)));
    return [...defaults, ...others];
  }, [query, sortDesc]);

  const totalRaw = React.useMemo(() => filtered.reduce((acc, d) => acc + d.debtRaw, 0n), [filtered]);

  const copy = async (addr: string) => {
    try {
      await navigator.clipboard.writeText(addr);
    } catch (err) {
      console.error("copy failed", err);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
      {/* Header */}
      <div className="py-5">
        <h1 className="text-xl font-semibold leading-tight">
          {t("pages.debtors.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("pages.debtors.subtitle", { token: "USDC" })}
        </p>
      </div>

      <Card className="p-4 sm:p-5">
        {/* Top summary + controls */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Total */}
          <div className="flex items-center gap-3">
            <USDCIcon className="h-5 w-5 shrink-0" />
            <div>
              <div className="text-xs text-muted-foreground">
                {t("pages.debtors.total.label")}
              </div>
              <div className="font-mono text-base tabular-nums">
                {fmtUSDC(totalRaw)} USDC
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("pages.debtors.filter.placeholder")}
              className="w-full sm:w-64"
              inputMode="text"
              aria-label={t("pages.debtors.filter.aria")}
            />
            <Button
              variant="outline"
              onClick={() => setSortDesc((v) => !v)}
              className="whitespace-nowrap"
              aria-label={t("pages.debtors.sort.aria")}
            >
              {sortDesc
                ? t("pages.debtors.sort.desc")
                : t("pages.debtors.sort.asc")}
            </Button>
          </div>
        </div>

        <Separator className="my-4" />

        {/* List */}
        {filtered.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {t("pages.debtors.empty")}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {filtered.map((d) => (
              <li key={d.address}>
                <div
                  className={[
                    "rounded-xl border p-3 sm:p-4",
                    "bg-card/40 backdrop-blur",
                    d.inDefault ? "ring-1 ring-red-500/30 bg-red-50/70" : "",
                  ].join(" ")}
                >
                  {/* Row 1 */}
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm truncate max-w-[55%] sm:max-w-none">
                      {shorten(d.address)}
                    </span>
                    {d.inDefault ? (
                      <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 leading-none shadow-sm shrink-0">
                        {t("pages.debtors.status.default")}
                      </span>
                    ) : null}
                    <div className="ml-auto inline-flex items-center gap-2">
                      <span className="font-mono text-base tabular-nums">
                        {fmtUSDC(d.debtRaw)}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#2775CA]/10 px-2 py-0.5 text-[11px]">
                        <USDCIcon className="h-3.5 w-3.5" />
                        <span className="font-semibold">USDC</span>
                      </span>
                    </div>
                  </div>

                  {/* Row 2 (mobile full address + copy) */}
                  <div className="mt-2 flex items-center justify-between sm:hidden">
                    <span className="font-mono text-[11px] text-muted-foreground break-all pr-3">
                      {d.address}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2"
                      onClick={() => copy(d.address)}
                      aria-label={t("pages.debtors.copy.aria")}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {/* Desktop copy action */}
                  <div className="hidden sm:flex sm:justify-between sm:pt-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      {d.address}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2"
                      onClick={() => copy(d.address)}
                      aria-label={t("pages.debtors.copy.aria")}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      <span className="sr-only">Copy</span>
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
