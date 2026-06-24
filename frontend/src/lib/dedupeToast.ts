// src/lib/dedupeToast.ts
// Wrapper around sonner's toast that prevents duplicate messages.
// Uses the message string as the toast id — if a toast with the same message
// is already visible, sonner will ignore the new one instead of stacking.

import { toast, type ExternalToast } from "sonner";

function toId(msg: string): string {
  return msg;
}

export const dedupeToast = {
  error(msg: string, opts?: ExternalToast) {
    toast.error(msg, { id: toId(msg), ...opts });
  },
  success(msg: string, opts?: ExternalToast) {
    toast.success(msg, { id: toId(msg), ...opts });
  },
  info(msg: string, opts?: ExternalToast) {
    toast.info(msg, { id: toId(msg), ...opts });
  },
  warning(msg: string, opts?: ExternalToast) {
    toast.warning(msg, { id: toId(msg), ...opts });
  },
};
