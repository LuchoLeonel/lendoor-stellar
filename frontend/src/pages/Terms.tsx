import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import TermsBody from "@/components/terms-and-conditions/TermsBody";

export default function TermsPage() {
  const { t } = useTranslation();
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" />
        {t("common.back")}
      </Link>
      <h1 className="text-2xl font-bold mb-6">{t("pages.terms.title")}</h1>
      <div className="prose prose-sm text-muted-foreground leading-relaxed">
        <TermsBody />
      </div>
    </div>
  );
}
