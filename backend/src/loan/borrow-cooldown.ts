// src/loan/borrow-cooldown.ts
import { BadRequestException } from '@nestjs/common';

/**
 * Cooldown post-repago (min_hold del LoanManager). Devuelve el error a tirar
 * si el borrower todavía no puede abrir un préstamo nuevo, o null si puede.
 *
 * @param nextAt  next_borrow_time on-chain (unix s); 0 = sin cooldown
 * @param now     timestamp de la cadena (unix s)
 */
export function borrowCooldownError(
  nextAt: number,
  now: number,
): BadRequestException | null {
  if (!nextAt || now >= nextAt) return null;
  const fecha = new Date(nextAt * 1000).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return new BadRequestException({
    code: 'BORROW_COOLDOWN',
    message: `Ya repagaste tu préstamo anterior. Podés pedir uno nuevo desde el ${fecha} (hora de Argentina).`,
    nextBorrowAt: new Date(nextAt * 1000).toISOString(),
  });
}
