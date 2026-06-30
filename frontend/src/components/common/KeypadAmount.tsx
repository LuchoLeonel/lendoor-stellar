import * as React from 'react';

/**
 * Monto grande de los teclados de acción (depósito / retiro), estilo "MP" —
 * mismo lenguaje que el resumen de repago (RepayPanel):
 *   • entero + 2 decimales (centavos) GRANDE
 *   • decimales 3º-6º (sub-centavo / "dust") chicos y elevados (superíndice)
 *   • auto-shrink por longitud → nunca desborda (ej. 50.255555, 1234.56…)
 *
 * Respeta lo que se tipea: "5" → "$5" (no fuerza ".00"); "5.8" → "$5.8";
 * "0.846012" → "$0.84" + ⁶⁰¹². La cola sólo aparece a partir del 3º decimal.
 */
export function KeypadAmount({
  value,
  color = '#334155',
}: {
  value: string;
  color?: string;
}) {
  const v = value || '0';
  const dot = v.indexOf('.');
  const ip = dot === -1 ? v : v.slice(0, dot);
  const fr = dot === -1 ? '' : v.slice(dot + 1);
  const cents = fr.slice(0, 2);
  const tail = fr.slice(2); // 3º-6º decimal → superíndice

  // head = "$<int>" mientras no haya punto, o "$<int>.<centavos-tipeados>".
  const head = dot === -1 ? `$${ip}` : `$${ip}.${cents}`;

  // Auto-shrink: ancho aprox en `em` (la cola pesa 0.44 por ser superíndice) →
  // px que entran en ~320px de ancho útil del bottom-sheet, entre 40 y 80px.
  const effEm = (head.length + 0.44 * tail.length) * 0.62;
  const px = Math.max(40, Math.min(80, 320 / effEm));

  return (
    <p
      className="leading-none tabular-nums"
      style={{ fontSize: `${px}px`, fontWeight: 600, color }}
    >
      {head}
      {tail ? (
        <sup className="text-[0.44em] font-semibold" style={{ verticalAlign: '0.42em' }}>
          {tail}
        </sup>
      ) : null}
    </p>
  );
}
