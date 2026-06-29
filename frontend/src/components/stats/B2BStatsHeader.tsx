import { useProtocolStat } from "@/hooks/stats/useProtocolStat";

function formatUsd(value?: string | number | null) {
  const n = Number(value ?? 0) / 1_000_000;
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

export function B2BStatsHeader() {
  const { stat } = useProtocolStat();

  const metrics = [
    { label: "Originado", value: formatUsd(stat?.principalOriginated) },
    { label: "Repaid", value: formatUsd(stat?.principalRepaid) },
    { label: "Préstamos", value: stat?.loansOriginated ?? 0 },
  ];

  return (
    <section className="mb-8">
      <div className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">
          Lendoor stats
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-950 sm:text-4xl">
          Señales operativas del protocolo
        </h1>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="rounded-lg border border-zinc-200 p-4"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              {metric.label}
            </p>
            <p className="mt-2 text-2xl font-semibold text-zinc-950">
              {metric.value}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
