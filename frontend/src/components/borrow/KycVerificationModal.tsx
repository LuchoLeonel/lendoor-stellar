// src/components/borrow/KycVerificationModal.tsx
"use client";

/**
 * D1.3 — Mockup de verificación de identidad (KYC) para el demo del SCF.
 *
 * Flujo: documento (cámara) → selfie (cámara) → "verificando" → aprobado.
 * Por detrás llama al backend real: `POST /kyc/start` (crea la sesión y deja
 * kycStatus=pending) y, como el proveedor en testnet es el FAKE, resuelve la
 * sesión con `POST /kyc/sandbox/decision` (approved). Así el gate del borrow
 * (assertKycGate) pasa de bloquear (403) a dejar pasar — que es la evidencia
 * que pide el entregable. El vendor real (Didit) entra por el mismo puerto en
 * mainnet sin tocar esto.
 *
 * La cámara es real (getUserMedia). Si el usuario niega el permiso o no hay
 * cámara, cae a un modo "sin cámara" para que el demo nunca se trabe.
 */
import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useApi } from "@/hooks/useApi";
import { Loader2, Camera, ScanLine, CheckCircle2, UserRound } from "lucide-react";

type Stage = "doc" | "selfie" | "verifying" | "approved" | "error";

export function KycVerificationModal({
  open,
  onClose,
  onApproved,
}: {
  open: boolean;
  onClose: () => void;
  onApproved: () => void;
}) {
  const api = useApi();
  const [stage, setStage] = React.useState<Stage>("doc");
  const [docShot, setDocShot] = React.useState<string | null>(null);
  const [selfieShot, setSelfieShot] = React.useState<string | null>(null);
  const [camError, setCamError] = React.useState<string | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);

  const stopCamera = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // Reset al abrir.
  React.useEffect(() => {
    if (open) {
      setStage("doc");
      setDocShot(null);
      setSelfieShot(null);
      setCamError(null);
      setErrorMsg(null);
    } else {
      stopCamera();
    }
  }, [open, stopCamera]);

  // Encender/apagar cámara según la etapa.
  React.useEffect(() => {
    if (!open) return;
    const wantsCamera = stage === "doc" || stage === "selfie";
    if (!wantsCamera) {
      stopCamera();
      return;
    }
    let cancelled = false;
    setCamError(null);
    const facingMode = stage === "doc" ? "environment" : "user";
    if (!navigator.mediaDevices?.getUserMedia) {
      // Contexto no seguro o webview sin cámara: modo "sin cámara".
      setCamError("Este navegador no da acceso a la cámara.");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }
      })
      .catch(() => {
        if (!cancelled) setCamError("No pudimos acceder a la cámara.");
      });
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [stage, open, stopCamera]);

  React.useEffect(() => () => stopCamera(), [stopCamera]);

  function capture(): string | null {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    try {
      return canvas.toDataURL("image/jpeg", 0.7);
    } catch {
      return null;
    }
  }

  function handleCaptureDoc() {
    setDocShot(capture() ?? "placeholder");
    stopCamera();
    setStage("selfie");
  }

  function handleCaptureSelfie() {
    setSelfieShot(capture() ?? "placeholder");
    stopCamera();
    void runVerification();
  }

  async function runVerification() {
    setStage("verifying");
    setErrorMsg(null);
    try {
      const started = await api.startKyc();
      // Si ya estaba aprobado, /kyc/start no devuelve sesión: no hay nada
      // que resolver en el sandbox.
      if (started.status !== "approved" && started.sessionId) {
        await api.approveKycSandbox(started.sessionId);
      }
      // Solo mostramos "aprobado" si el estado PERSISTIDO lo confirma (es lo
      // que lee el gate del borrow); si no, error y reintento.
      const persisted = await api.getKycStatus();
      if (persisted.status !== "approved") {
        throw new Error("La verificación todavía no se confirmó. Probá de nuevo.");
      }
      setStage("approved");
    } catch (e) {
      setErrorMsg(
        e instanceof Error ? e.message : "No pudimos completar la verificación.",
      );
      setStage("error");
    }
  }

  function handleApprovedClose() {
    onApproved();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md overflow-hidden p-0">
        <DialogTitle className="sr-only">Verificación de identidad</DialogTitle>
        <DialogDescription className="sr-only">
          Verificación de identidad de demostración (sandbox de testnet).
        </DialogDescription>

        {/* Encabezado */}
        <div className="border-b border-border/50 bg-card px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
            Verificación de identidad · Demo testnet
          </p>
          <h2 className="mt-0.5 text-lg font-bold leading-tight">
            {stage === "doc" && "Escaneá tu documento"}
            {stage === "selfie" && "Sacate una selfie"}
            {stage === "verifying" && "Verificando tu identidad"}
            {stage === "approved" && "Identidad verificada"}
            {stage === "error" && "No se pudo verificar"}
          </h2>
        </div>

        <div className="px-5 py-5">
          {/* DOC / SELFIE — visor de cámara */}
          {(stage === "doc" || stage === "selfie") && (
            <>
              <div
                className={[
                  "relative mx-auto overflow-hidden bg-black",
                  stage === "doc"
                    ? "aspect-[1.586/1] w-full rounded-xl"
                    : "aspect-square w-56 rounded-full",
                ].join(" ")}
              >
                {!camError ? (
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted text-muted-foreground">
                    <Camera className="h-7 w-7" />
                    <span className="px-4 text-center text-[12px]">{camError}</span>
                  </div>
                )}
                {/* Marco guía */}
                <div
                  className={[
                    "pointer-events-none absolute inset-3",
                    stage === "doc"
                      ? "rounded-lg border-2 border-dashed border-white/80"
                      : "rounded-full border-2 border-dashed border-white/80",
                  ].join(" ")}
                />
                {stage === "doc" ? (
                  <ScanLine className="pointer-events-none absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 text-white/70" />
                ) : (
                  <UserRound className="pointer-events-none absolute left-1/2 top-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 text-white/70" />
                )}
              </div>

              <p className="mt-3 text-center text-[13px] leading-snug text-muted-foreground">
                {stage === "doc"
                  ? "Encuadrá el frente de tu DNI dentro del marco."
                  : "Mirá a la cámara y mantené el rostro dentro del círculo."}
              </p>

              <Button
                type="button"
                size="xl"
                onClick={stage === "doc" ? handleCaptureDoc : handleCaptureSelfie}
                className="mt-4 h-14 w-full rounded-xl text-[15px] font-semibold uppercase tracking-wider"
              >
                <Camera className="mr-2 h-4 w-4" />
                {camError ? "Continuar" : "Capturar"}
              </Button>

              {/* progreso simple */}
              <div className="mt-4 flex items-center justify-center gap-1.5">
                <span className="h-1.5 w-6 rounded-full bg-primary" />
                <span
                  className={[
                    "h-1.5 w-6 rounded-full",
                    stage === "selfie" ? "bg-primary" : "bg-border",
                  ].join(" ")}
                />
                <span className="h-1.5 w-6 rounded-full bg-border" />
              </div>
            </>
          )}

          {/* VERIFICANDO */}
          {stage === "verifying" && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="flex items-center gap-3">
                {docShot && docShot !== "placeholder" && (
                  <img
                    src={docShot}
                    alt="documento"
                    className="h-12 w-20 rounded-md object-cover ring-1 ring-border"
                  />
                )}
                {selfieShot && selfieShot !== "placeholder" && (
                  <img
                    src={selfieShot}
                    alt="selfie"
                    className="h-12 w-12 rounded-full object-cover ring-1 ring-border"
                  />
                )}
              </div>
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-center text-[13px] text-muted-foreground">
                Verificando con el proveedor de prueba (sandbox de testnet)…
              </p>
            </div>
          )}

          {/* APROBADO */}
          {stage === "approved" && (
            <div className="flex flex-col items-center gap-4 py-7">
              <CheckCircle2 className="h-14 w-14 text-emerald-500" />
              <p className="text-center text-[14px] leading-snug text-muted-foreground">
                Tu identidad quedó verificada. Ya podés operar tu línea de
                crédito.
              </p>
              <Button
                type="button"
                size="xl"
                onClick={handleApprovedClose}
                className="h-14 w-full rounded-xl text-[15px] font-semibold uppercase tracking-wider"
              >
                Continuar
              </Button>
            </div>
          )}

          {/* ERROR */}
          {stage === "error" && (
            <div className="flex flex-col items-center gap-4 py-7">
              <p className="text-center text-[13px] leading-snug text-red-600">
                {errorMsg}
              </p>
              <Button
                type="button"
                size="xl"
                onClick={() => setStage("doc")}
                className="h-14 w-full rounded-xl text-[15px] font-semibold uppercase tracking-wider"
              >
                Reintentar
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
