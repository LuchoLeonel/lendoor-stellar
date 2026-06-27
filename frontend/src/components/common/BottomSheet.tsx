import * as React from "react";
import { ArrowLeft, X } from "lucide-react";

type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  onBack?: () => void;
  children: React.ReactNode;
};

export function BottomSheet({
  open,
  onClose,
  onBack,
  children,
}: BottomSheetProps) {
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90]">
      <button
        type="button"
        aria-label="Cerrar"
        className="absolute inset-0 h-full w-full bg-black/40"
        onClick={onClose}
      />
      <section className="absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-hidden rounded-t-3xl bg-white shadow-2xl">
        <div className="flex h-12 items-center justify-between border-b border-zinc-100 px-3">
          {onBack ? (
            <button
              type="button"
              aria-label="Volver"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-zinc-700 hover:bg-zinc-100"
              onClick={onBack}
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          ) : (
            <span className="h-9 w-9" />
          )}
          <div className="h-1.5 w-10 rounded-full bg-zinc-200" />
          <button
            type="button"
            aria-label="Cerrar"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-zinc-700 hover:bg-zinc-100"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[calc(92dvh-3rem)] overflow-y-auto">
          {children}
        </div>
      </section>
    </div>
  );
}
