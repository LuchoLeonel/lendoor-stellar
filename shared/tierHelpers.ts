import { MAX_CREDIT_LEVEL } from './constants';

const GROUP_BY_SCORE: Record<number, string> = {
  1: 'Novato',
  2: 'Novato',
  3: 'Activo',
  4: 'Activo',
  5: 'Estable',
  6: 'Estable',
  7: 'Confiable',
  8: 'Confiable',
  9: 'Referente',
  10: 'Referente',
  11: 'Leyenda',
};

export function getGroupLabelForScore(score: number | null | undefined): string {
  const n = typeof score === 'number' && Number.isFinite(score) ? Math.round(score) : 1;
  const clamped = Math.max(1, Math.min(MAX_CREDIT_LEVEL, n));
  return GROUP_BY_SCORE[clamped] ?? 'Novato';
}
