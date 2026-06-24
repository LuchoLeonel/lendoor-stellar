import * as React from "react";
import { Mail, Phone, FileText, Shield } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";

type ConfigTabProps = {
  email?: string | null;
  phoneVerified?: boolean;
  phoneMasked?: string | null;
};

export function ConfigTab({ email, phoneVerified, phoneMasked }: ConfigTabProps) {
  const { t } = useTranslation();

  const items = [
    {
      icon: Mail,
      label: t("tabs.configScreen.email"),
      value: email || t("tabs.configScreen.notSet"),
      set: !!email,
    },
    {
      icon: Phone,
      label: t("tabs.configScreen.phone"),
      value: phoneMasked || (phoneVerified ? t("tabs.configScreen.phoneVerified") : t("tabs.configScreen.notSet")),
      set: !!phoneVerified,
    },
  ];

  const links = [
    {
      icon: FileText,
      label: t("pages.terms.title"),
      href: "/terms",
    },
    {
      icon: Shield,
      label: t("pages.privacy.title"),
      href: "/privacy",
    },
  ];

  return (
    <div className="px-5 pt-6 pb-32">
      <h2 className="text-xl font-bold mb-1">{t("tabs.configScreen.title")}</h2>
      <p className="text-sm text-muted-foreground mb-6">{t("tabs.configScreen.subtitle")}</p>

      {/* User info */}
      <div className="space-y-3 mb-8">
        {items.map(({ icon: Icon, label, value, set }) => (
          <div
            key={label}
            className="flex items-center gap-3 rounded-xl border border-border/50 bg-background px-4 py-3.5"
          >
            <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">{label}</p>
              <p className={`text-[15px] truncate ${set ? "text-foreground" : "text-muted-foreground/50 italic"}`}>
                {value}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Legal links */}
      <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium mb-3">
        {t("tabs.configScreen.legal")}
      </p>
      <div className="space-y-2">
        {links.map(({ icon: Icon, label, href }) => (
          <a
            key={href}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-xl border border-border/50 bg-background px-4 py-3.5 hover:bg-muted/50 transition-colors"
          >
            <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
            <span className="text-[15px] text-foreground flex-1">{label}</span>
            <svg className="h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m9 18 6-6-6-6" />
            </svg>
          </a>
        ))}
      </div>
    </div>
  );
}
