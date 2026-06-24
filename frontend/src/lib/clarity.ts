// src/lib/clarity.ts
import Clarity from "@microsoft/clarity"
import { CLARITY_ID, NODE_ENV } from "@/lib/constants"

declare global {
  interface Window {
    __CLARITY_INITIALIZED__?: boolean
  }
}

export function initClarity() {
  // Sólo corre en browser
  if (typeof window === "undefined") return

  // ▶️ Sólo en producción
  if (NODE_ENV !== "production") {
    console.info("[Clarity] skip init (NODE_ENV =", NODE_ENV + ")")
    return
  }

  // Evitar doble init
  if (window.__CLARITY_INITIALIZED__) return

  const projectId = CLARITY_ID
  if (!projectId) {
    console.warn("[Clarity] falta VITE_CLARITY_ID")
    return
  }

  Clarity.init(projectId)
  window.__CLARITY_INITIALIZED__ = true
  console.log("[Clarity] initialized with", projectId)
}
