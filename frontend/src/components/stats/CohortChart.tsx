import { VaultUtilizationBar } from "@/components/stats/VaultUtilizationBar";

export function CohortChart() {
  return (
    <section className="rounded-lg border border-zinc-200 p-5">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
          Utilización
        </p>
        <h2 className="mt-1 text-xl font-semibold text-zinc-950">
          Capital deployado vs. disponible
        </h2>
      </div>
      <VaultUtilizationBar />
    </section>
  );
}
