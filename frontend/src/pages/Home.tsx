// src/pages/Home.tsx
import { useState, useEffect, useMemo, useRef } from "react";
import { ArrowRight, Coins, TrendingUp, Shield } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "@/i18n/useTranslation";
import { motion } from "framer-motion";
import PixelBlast from "@/components/reactbits/PixelBlast";
import { SplitText } from "@/components/reactbits/SplitText";
import ShinyText from "@/components/reactbits/ShinyText";
import { RotatingText } from "@/components/reactbits/RotatingText";
import { AnimatedContent } from "@/components/reactbits/AnimatedContent";
import { SpotlightCard } from "@/components/reactbits/SpotlightCard";
import { BorderBeam } from "@/components/reactbits/BorderBeam";
import BlurText from "@/components/reactbits/BlurText";

function MissionSequence({ text }: { text: string }) {
  const sentences = useMemo(
    () => text.split(" | "),
    [text]
  );

  // Calculate cumulative start time for each sentence
  const startTimes = useMemo(() => {
    const times: number[] = [0];
    for (let i = 0; i < sentences.length - 1; i++) {
      const chars = sentences[i].length;
      // Total animation time: last letter delay + animation duration + pause
      const sentenceDuration = (chars - 1) * 20 + 250 + 200;
      times.push(times[i] + sentenceDuration);
    }
    return times;
  }, [sentences]);

  const [visibleCount, setVisibleCount] = useState(0);
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Detect when section enters viewport
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setInView(true); observer.disconnect(); } },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Reveal sentences one by one with precise timing
  useEffect(() => {
    if (!inView) return;
    const timers = sentences.map((_, i) =>
      setTimeout(() => setVisibleCount(i + 1), startTimes[i])
    );
    return () => timers.forEach(clearTimeout);
  }, [inView, sentences, startTimes]);

  return (
    <section className="pt-0 pb-14 md:pb-24">
      <div ref={ref} className="max-w-4xl mx-auto text-center space-y-2">
        {sentences.map((sentence, i) => (
          <div key={i} className="relative">
            {/* Invisible placeholder — always reserves space */}
            <p className="text-lg sm:text-2xl md:text-4xl font-bold leading-snug tracking-tight invisible" aria-hidden>
              {sentence}
            </p>
            {/* Animated text — absolutely positioned over the placeholder */}
            {i < visibleCount && (
              <div className="absolute inset-0">
                <BlurText
                  text={sentence}
                  delay={20}
                  animateBy="letters"
                  direction="bottom"
                  stepDuration={0.25}
                  className="text-lg sm:text-2xl md:text-4xl font-bold leading-snug tracking-tight text-foreground text-center"
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Home() {
  const { t } = useTranslation();

  // DEBUG: track scroll shifts
  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;
    let prev = root.scrollTop;
    const observer = new MutationObserver(() => {
      if (root.scrollTop !== prev) {
        console.log(`[SCROLL SHIFT] ${prev} → ${root.scrollTop} (delta: ${root.scrollTop - prev})`);
        prev = root.scrollTop;
      }
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true });
    const interval = setInterval(() => {
      if (root.scrollTop !== prev) {
        console.log(`[SCROLL SHIFT poll] ${prev} → ${root.scrollTop} (delta: ${root.scrollTop - prev})`);
        prev = root.scrollTop;
      }
    }, 100);
    return () => { observer.disconnect(); clearInterval(interval); };
  }, []);

  const stats = [
    { label: t("pages.home.stats.protocol"), value: t("pages.home.stats.protocolValue") },
    { label: t("pages.home.stats.collateral"), value: t("pages.home.stats.collateralValue") },
    { label: t("pages.home.stats.currency"), value: t("pages.home.stats.currencyValue") },
    { label: t("pages.home.stats.region"), value: t("pages.home.stats.regionValue") },
  ];

  const rotating = t("pages.home.hero.rotating", { returnObjects: true }) as string[];

  const steps = [
    { icon: Shield, title: t("pages.home.howItWorks.step1Title"), desc: t("pages.home.howItWorks.step1Desc") },
    { icon: Coins, title: t("pages.home.howItWorks.step2Title"), desc: t("pages.home.howItWorks.step2Desc") },
  ];

  return (
    <div>
      {/* ═══════════════════════════════════════════════════════
          HERO — full width with PixelBlast background
      ═══════════════════════════════════════════════════════ */}
      <section className="relative w-full min-h-[calc(100vh-4rem)] flex items-start overflow-hidden">
        <div className="absolute inset-0 z-0 opacity-[0.35] sm:opacity-100">
          <PixelBlast
            pixelSize={4}
            color="#f97415"
            edgeFade={0.15}
            speed={0.4}
            enableRipples={true}
            rippleIntensityScale={0.5}
            rippleThickness={0.12}
            rippleSpeed={0.35}
            patternDensity={0.97}
            transparent={true}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/30 to-transparent pointer-events-none" />
        </div>

        <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 pt-10 pb-16 md:pt-14 md:pb-24 pointer-events-none [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="relative z-10"
          >
            <p className="text-sm text-primary mb-6 tracking-widest uppercase font-medium">
              <ShinyText text="Lendoor Protocol" speed={4} color="#F97415" shineColor="#ffffff" />
            </p>

            <h1 className="text-4xl sm:text-4xl md:text-5xl lg:text-7xl font-bold text-foreground tracking-tight leading-[0.95] max-w-4xl break-words">
              <SplitText text={t("pages.home.hero.title")} delay={0.08} />
              <br />
              <span className="text-primary">
                <RotatingText
                  texts={Array.isArray(rotating) ? rotating : ["sin colateral.", "basado en reputación.", "para LATAM.", "en minutos."]}
                  interval={2500}
                  className="min-h-[1.1em]"
                />
              </span>
            </h1>

            <p className="text-base md:text-xl text-foreground/80 mt-8 max-w-lg leading-relaxed drop-shadow-[0_1px_2px_rgba(255,255,255,0.8)]">
              {t("pages.home.hero.subtitle")}
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="flex flex-col sm:flex-row gap-3 mt-10 relative z-10"
          >
            <Link
              to="/borrow"
              data-testid="hero-cta-borrow"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold text-white rounded-2xl transition-all active:scale-[0.98]"
              style={{ backgroundColor: '#F97415', boxShadow: '0 4px 16px rgba(249,116,21,0.30)' }}
            >
              {t("pages.home.hero.cta")}
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/stats"
              data-testid="hero-cta-stats"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-medium rounded-2xl border border-border bg-white/80 backdrop-blur-sm hover:bg-white transition-colors"
            >
              <TrendingUp className="w-4 h-4" />
              {t("common.nav.stats")}
            </Link>
          </motion.div>

          <AnimatedContent delay={0.3} className="relative z-10">
            <BorderBeam duration={8}>
              <div className="mt-12 md:mt-28 grid grid-cols-2 md:grid-cols-4 gap-px bg-border rounded-xl overflow-hidden border border-border">
                {stats.map((stat) => (
                  <div key={stat.label} className="bg-background p-3 sm:p-5 md:p-6">
                    <div className="text-xs text-muted-foreground mb-2 uppercase tracking-widest">{stat.label}</div>
                    <div className="text-xl md:text-2xl font-semibold font-mono text-foreground">{stat.value}</div>
                  </div>
                ))}
              </div>
            </BorderBeam>
          </AnimatedContent>
        </div>
      </section>

      <div className="relative">
        <main className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6">
        {/* How It Works */}
        <section className="pb-14 md:pb-32">
          <AnimatedContent>
            <div className="border-t border-border pt-14 md:pt-20">
              <div className="md:grid md:grid-cols-12 md:gap-16">
                <div className="md:col-span-4 mb-8 md:mb-0">
                  <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
                    {t("pages.home.howItWorks.title")}
                  </h2>
                  <p className="text-muted-foreground mt-3 text-sm leading-relaxed max-w-sm">
                    {t("pages.home.howItWorks.subtitle")}
                  </p>
                </div>

                <div className="md:col-span-8 space-y-4">
                  {steps.map((item, i) => (
                    <SpotlightCard key={item.title} className="p-6 md:p-8">
                      <AnimatedContent delay={i * 0.1}>
                        <div className="flex gap-4 md:gap-6 group">
                          <div className="w-10 h-10 rounded-lg bg-muted border border-border flex items-center justify-center flex-shrink-0 mt-0.5 group-hover:border-primary/30 transition-colors">
                            <item.icon className="w-5 h-5 text-primary/70" />
                          </div>
                          <div>
                            <h3 className="text-base font-semibold mb-1.5 text-foreground">{item.title}</h3>
                            <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                          </div>
                        </div>
                      </AnimatedContent>
                    </SpotlightCard>
                  ))}
                </div>
              </div>
            </div>
          </AnimatedContent>
        </section>

        {/* Mission */}
        <MissionSequence text={t("pages.home.mission")} />

        {/* Bottom CTA */}
        <section className="relative z-10 pb-24 md:pb-32">
          <AnimatedContent>
            <div className="text-center">
              <h2 className="text-2xl md:text-4xl font-bold text-foreground tracking-tight mb-4">
                {t("pages.home.bottomCta.title")}
              </h2>
              <p className="text-muted-foreground mb-8 max-w-md mx-auto">
                {t("pages.home.bottomCta.subtitle")}
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Link
                  to="/borrow"
                  className="inline-flex items-center justify-center gap-2 px-8 py-3 text-sm font-semibold text-white rounded-2xl transition-all active:scale-[0.98]"
                  style={{ backgroundColor: '#F97415', boxShadow: '0 4px 16px rgba(249,116,21,0.30)' }}
                >
                  {t("pages.home.bottomCta.borrowCta")}
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  to="/stats"
                  className="inline-flex items-center justify-center gap-2 px-8 py-3 text-sm font-medium rounded-2xl border border-border hover:bg-muted transition-colors"
                >
                  <TrendingUp className="w-4 h-4" />
                  {t("common.nav.stats")}
                </Link>
              </div>
            </div>
          </AnimatedContent>
        </section>
      </main>
      </div>

    </div>
  );
}
