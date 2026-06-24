import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Base mobile-friendly: mismo espíritu que tus inputs anteriores
        "w-full min-w-0 rounded-xl border border-border bg-background px-3.5 py-3.5 text-[15px] md:text-sm shadow-xs outline-none",
        // Texto, placeholder y selección
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground",
        // File input support
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        // Disabled / transición
        "transition-[border-color,box-shadow] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        // Dark mode base
        "dark:bg-input/30 dark:border-input",

        // 🎨 Focus pastel SOLO en el contorno (borde + ring), NO cambia el bg
        "focus-visible:ring-2 focus-visible:ring-orange-200/80 focus-visible:border-orange-200",
        "dark:focus-visible:ring-orange-300/70 dark:focus-visible:border-orange-300/70",

        // Estado de error se mantiene
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",

        className
      )}
      {...props}
    />
  )
}

export { Input }
