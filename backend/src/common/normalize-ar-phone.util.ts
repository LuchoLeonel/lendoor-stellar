// src/common/normalize-ar-phone.util.ts
//
// Normaliza phones AR mobile a E.164 estricto agregando el "9" obligatorio
// entre código de país y número de área (+549...).
//
// USO REAL: solo el voice flow (collections.service.ts → Telnyx outbound).
// Telnyx valida estricto y devuelve 404 Invalid Destination si el AR mobile
// llega sin el "9".
//
// NO USAR para WhatsApp: Kapso/Meta auto-normaliza AR (verificado 2026-05-25,
// el wamid de retorno incluye "5491..." aunque mandes "541..."). El falso
// "bug" del 9 en cron WA fue investigado y refutado (ver spec 074 día 2).
//
// PE / CO / US / otros países: sin cambios.

export function normalizeArPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  if (phone.startsWith('+54') && !phone.startsWith('+549')) {
    return '+549' + phone.slice(3);
  }
  return phone;
}
