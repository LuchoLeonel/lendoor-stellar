import { useEffect, useState } from "react";

// Métricas del protocolo EN VIVO desde la API pública (las mismas que sirven
// la mini-app y el subgraph). Si el fetch falla —CORS en dev local, porque
// prod sólo habilita lendoor.xyz, o la API caída— quedan los valores del
// último snapshot verificado contra producción, así la landing nunca muestra
// ceros ni se rompe.
//
// OJO con la semántica: la API publica TOTALES históricos. El default por
// cohorte NO está acá; por eso la landing muestra repago histórico y
// borrowers (respaldables) y no cifras de mora mensual.
export type ProtocolStats = {
  loans: number; // préstamos originados (count)
  borrowers: number; // borrowers únicos
  gmvK: number; // capital originado, en miles de USD
  repaidPct: number; // % del principal originado ya repagado
};

// Verificado contra la DB de producción el 2026-08-10.
const SNAPSHOT: ProtocolStats = {
  loans: 4550,
  borrowers: 1155,
  gmvK: 37.9,
  repaidPct: 84,
};

export function useProtocolStats(): ProtocolStats {
  const [stats, setStats] = useState<ProtocolStats>(SNAPSHOT);
  useEffect(() => {
    let vivo = true;
    fetch("https://api.lendoor.xyz/public-stats/protocol-stat")
      .then((r) => r.json())
      .then(({ protocolStat: p }) => {
        if (!vivo || !p) return;
        const originado = Number(p.principalOriginated);
        setStats({
          loans: Number(p.loansOriginated),
          borrowers: Number(p.uniqueBorrowers),
          gmvK: Math.round(originado / 1e8) / 10,
          repaidPct: Math.round((Number(p.principalRepaid) / Math.max(1, originado)) * 100),
        });
      })
      .catch(() => {
        /* queda el snapshot */
      });
    return () => {
      vivo = false;
    };
  }, []);
  return stats;
}
