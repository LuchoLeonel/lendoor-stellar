// src/pages/WalletLink.tsx
// Spec 084 — Companion "conectá tu wallet desde la computadora".
// Página web (fuera del mini-app) donde el user loguea con su email (OTP),
// conecta una wallet externa (RainbowKit) y firma un mensaje para probar
// propiedad. El mini-app pollea y muestra "Wallet conectada".
//
// Estilo propio (blanco/limpio, acento naranja #F97415, Inter, cards
// redondeadas) — alineado con el resto del redesign, NO el azul de UV.
//
// `?demo=1` → recorre todas las pantallas con datos mock (sin backend), para
// previsualizar el diseño antes de que existan los endpoints /wallet-link/*.
'use client';

import * as React from 'react';
import { useAccount, useSignMessage, useDisconnect } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { Loader2, CheckCircle2, Wallet, ArrowLeft, ShieldCheck } from 'lucide-react';
import { lendoorApi as api } from '@/lib/api';

const ORANGE = '#F97415';
const INK = '#15233b';

type Step = 'email' | 'otp' | 'wallets' | 'verifying' | 'success';
type OtpStatus = 'idle' | 'checking' | 'ok' | 'error';

type LinkedWallet = { address: string; verifiedAt?: string; icon?: string };

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

const isDemo = () =>
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo');

// La sesión (token opaco, TTL 15 min, scope wallet_link) se guarda en
// sessionStorage para que un refresh del navegador NO te devuelva al login.
// Es por-pestaña y se borra al cerrarla; si el token venció, el fetch de
// wallets da 401 y volvemos a email.
const SS_KEY = 'lendoor.walletlink.session';
type Persisted = { linkSession: string; lendoorAddr: string | null; email: string };
const saveSession = (p: Persisted) => { try { sessionStorage.setItem(SS_KEY, JSON.stringify(p)); } catch { /* storage off */ } };
const loadSession = (): Persisted | null => { try { return JSON.parse(sessionStorage.getItem(SS_KEY) || 'null'); } catch { return null; } };
const clearSession = () => { try { sessionStorage.removeItem(SS_KEY); } catch { /* noop */ } };

export default function WalletLink() {
  const [step, setStep] = React.useState<Step>('email');
  const [email, setEmail] = React.useState('');
  const [otp, setOtp] = React.useState('');
  const [linkSession, setLinkSession] = React.useState<string | null>(null);
  const [lendoorAddr, setLendoorAddr] = React.useState<string | null>(null);
  const [wallets, setWallets] = React.useState<LinkedWallet[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [lastLinked, setLastLinked] = React.useState<string | null>(null);
  const [otpStatus, setOtpStatus] = React.useState<OtpStatus>('idle');

  const { address, isConnected, connector } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { signMessageAsync } = useSignMessage();
  const { disconnect } = useDisconnect();

  const demo = isDemo();
  // Ícono del connector (MetaMask, etc.). El SDK suele exponer connector.icon;
  // si es MetaMask/injected usamos nuestro logo local como fallback.
  const connectorIcon: string | undefined =
    (connector as { icon?: string } | undefined)?.icon ??
    (/meta\s*mask|injected/i.test(connector?.name ?? '') ? '/logos/metamask.svg' : undefined) ??
    (demo ? '/logos/metamask.svg' : undefined);

  // Auto-sign: apenas se conecta la wallet, disparamos la firma (un solo flujo
  // continuo, como UV — no dos botones separados).
  const [autoSign, setAutoSign] = React.useState(false);
  // En demo usamos la wallet REAL (MetaMask): connect + firma reales, solo se
  // stubea email/OTP/verify (sin backend). Así se ve el ritmo real.
  const effConnected = isConnected;
  const effAddress = address;

  // ---- Step E: email → enviar OTP ----
  const sendOtp = async () => {
    setError(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setError('Ingresá un email válido.'); return; }
    setBusy(true);
    try {
      if (demo) { await wait(500); }
      else { await api.walletLinkStart({ email }); }
      setStep('otp');
    } catch {
      // anti-enumeration: el backend siempre responde 200; si falla la red:
      setError('No pudimos enviar el código. Reintentá.');
    } finally { setBusy(false); }
  };

  // ---- Step OTP: validar código → linkSession ----
  // Se auto-dispara al tipear el 6º dígito (ver effect abajo). En éxito mostramos
  // un tilde verde gratificante ~750ms y recién ahí pasamos a "wallets".
  const verifyOtp = async () => {
    if (otp.length < 6 || otpStatus === 'checking' || otpStatus === 'ok') return;
    setError(null);
    setOtpStatus('checking');
    setBusy(true);
    try {
      let session: string;
      let addr: string | null;
      let initialWallets: LinkedWallet[];
      if (demo) {
        await wait(500);
        session = 'demo-session';
        addr = '0x80925caba69b169dfe611c91d7143a126f2e704c';
        initialWallets = [];
      } else {
        const res = await api.walletLinkSession({ email, code: otp });
        session = res.linkSession;
        addr = res.lendoorAddress;
        const w = await api.walletLinkWallets(res.linkSession).catch(() => ({ wallets: [] }));
        initialWallets = w.wallets ?? [];
      }
      setLinkSession(session);
      setLendoorAddr(addr);
      setWallets(initialWallets);
      saveSession({ linkSession: session, lendoorAddr: addr, email });
      setOtpStatus('ok');
      setBusy(false);
      await wait(750);            // dejar ver el tilde antes de avanzar
      setStep('wallets');
    } catch {
      setOtpStatus('error');
      setBusy(false);
      setError('Código incorrecto. Probá de nuevo.');
      await wait(450);           // dura el shake
      setOtp('');                // limpiar para re-tipear (y evitar re-disparo)
      setOtpStatus('idle');
    }
  };

  // ---- Step W: conectar (auto-dispara firmar + verificar) ----
  const connectWallet = () => {
    setError(null);
    setAutoSign(true);        // firmar en cuanto haya conexión
    if (isConnected) {
      // Ya hay una wallet conectada → desconectar para poder elegir/cambiar
      // de cuenta antes de abrir el selector (sumar OTRA wallet).
      disconnect();
      window.setTimeout(() => openConnectModal?.(), 150);
    } else {
      openConnectModal?.();   // abre RainbowKit (MetaMask, etc.) — real
    }
  };

  const signAndVerify = React.useCallback(async () => {
    const addr = address;
    if (!addr) { return; }
    if (wallets.some((w) => w.address.toLowerCase() === addr.toLowerCase())) return; // ya verificada
    setError(null);
    setBusy(true);
    try {
      // 1) mensaje a firmar. Real: lo arma el server (nonce). Demo: lo armamos
      //    local (sin backend) para poder probar la firma de MetaMask igual.
      const message = demo
        ? `By signing, you are proving you own this wallet and linking it to your Lendoor account. This does not initiate a transaction or cost any fees.\n\nWallet: ${addr}\nNonce: demo-${Math.floor(performance.now())}`
        : (await api.walletLinkNonce({ address: addr, chainId: 1 }, linkSession!)).message;
      // 2) firmar (personal_sign — no cuesta gas, no mueve fondos) — REAL
      const signature = await signMessageAsync({ message, account: addr as `0x${string}` });
      // 3) firmado OK → pantalla "analizando on-chain" mientras el server verifica
      //    la firma y (job L3) lee la actividad de la EOA en todas las redes vía
      //    GoldRush. Un dwell mínimo para que el loading se lea como análisis real.
      setStep('verifying');
      const minDwell = wait(1700);
      if (!demo) {
        await api.walletLinkVerify({ address: addr, chainId: 1, message, signature }, linkSession!);
      } else {
        await wait(600);
      }
      await minDwell;
      setWallets((prev) => dedupe([...prev, { address: addr, verifiedAt: 'now', icon: connectorIcon }]));
      setLastLinked(addr);
      setStep('success');
    } catch (e: unknown) {
      const code = (e as { code?: number })?.code;
      if (code === 4001) setError('Cancelaste la firma. Tocá "Firmar para verificar" para reintentar.');
      else setError('No pudimos verificar la wallet. Reintentá.');
      setStep('wallets');   // volver al hub para reintentar
    } finally { setBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, demo, wallets, linkSession, signMessageAsync, connectorIcon]);

  // Auto-sign en cuanto la wallet queda conectada (flujo continuo tipo UV).
  React.useEffect(() => {
    if (autoSign && effConnected && effAddress && !busy) {
      setAutoSign(false);
      void signAndVerify();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSign, effConnected, effAddress]);

  // Auto-confirmar el OTP al tipear el 6º dígito (sin tocar botón → más smooth).
  React.useEffect(() => {
    if (step === 'otp' && otp.length === 6 && otpStatus === 'idle') {
      void verifyOtp();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp, step, otpStatus]);

  // Rehidratar sesión desde sessionStorage: un refresh del navegador no debería
  // devolverte al login. Si el token venció, el fetch de wallets da 401 → email.
  React.useEffect(() => {
    if (demo) return;
    const p = loadSession();
    if (!p?.linkSession) return;
    let alive = true;
    (async () => {
      try {
        const w = await api.walletLinkWallets(p.linkSession);
        if (!alive) return;
        setLinkSession(p.linkSession);
        setLendoorAddr(p.lendoorAddr);
        setEmail(p.email);
        setWallets(w.wallets ?? []);
        setStep('wallets');
      } catch {
        clearSession();   // token vencido/ inválido → arrancar de cero
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = () => { disconnect(); clearSession(); setAutoSign(false); setLinkSession(null); setWallets([]); setEmail(''); setOtp(''); setOtpStatus('idle'); setStep('email'); };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center overflow-y-auto bg-white px-5"
      style={{ paddingTop: 'calc(env(safe-area-inset-top,0px) + 3.5rem)', paddingBottom: '3rem' }}>
      <div className="w-full max-w-[420px]">
        {/* Logo */}
        <div className="mb-9 flex items-center justify-center">
          <img src="/favicon.png" alt="Lendoor" className="h-11 w-11 rounded-xl" />
        </div>

        {step === 'email' && (
          <Centered
            title="Conectá tu wallet"
            subtitle="Iniciá sesión con el email de tu cuenta Lendoor para vincular y verificar tus wallets."
          >
            <input
              type="email" inputMode="email" autoComplete="email"
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendOtp()}
              className="w-full rounded-2xl border px-4 py-3.5 text-[16px] outline-none transition-all"
              style={{ borderColor: 'rgba(0,0,0,0.12)', color: INK }}
            />
            <ErrorMsg error={error} />
            <PrimaryButton onClick={sendOtp} busy={busy}>Enviar código</PrimaryButton>
          </Centered>
        )}

        {step === 'otp' && (
          <Centered
            title="Ingresá el código"
            subtitle={<>Te enviamos un código de 6 dígitos a <span className="font-semibold" style={{ color: INK }}>{email}</span>.</>}
            onBack={otpStatus === 'ok' ? undefined : () => { setOtp(''); setError(null); setOtpStatus('idle'); setStep('email'); }}
          >
            {otpStatus === 'ok' ? (
              <div className="lk-step-in flex flex-col items-center py-3 text-center">
                <SuccessCheck size={66} />
                <p className="mt-4 text-[17px] font-semibold" style={{ color: INK }}>¡Código correcto!</p>
              </div>
            ) : (
              <>
                <input
                  autoFocus
                  inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                  placeholder="••••••"
                  value={otp}
                  disabled={otpStatus === 'checking'}
                  onChange={(e) => { if (error) setError(null); setOtp(e.target.value.replace(/\D/g, '').slice(0, 6)); }}
                  onKeyDown={(e) => e.key === 'Enter' && verifyOtp()}
                  className={`w-full rounded-2xl border px-4 py-3.5 text-center text-[26px] font-bold tracking-[0.4em] outline-none transition-colors ${otpStatus === 'error' ? 'lk-shake' : ''}`}
                  style={{ borderColor: otpStatus === 'error' ? '#ef4444' : 'rgba(0,0,0,0.12)', color: INK }}
                />
                <ErrorMsg error={error} center />
                {otpStatus === 'checking' ? (
                  <div className="mt-5 flex items-center justify-center gap-2 text-[14px] font-medium text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Verificando…
                  </div>
                ) : (
                  <button type="button" onClick={sendOtp} disabled={busy}
                    className="mt-5 w-full cursor-pointer py-1 text-center text-[14px] font-medium transition-opacity active:opacity-60 disabled:opacity-50"
                    style={{ color: ORANGE }}>
                    Reenviar código
                  </button>
                )}
              </>
            )}
          </Centered>
        )}

        {step === 'wallets' && (
          <div>
            <h1 className="text-center text-[24px] font-extrabold leading-tight" style={{ color: INK }}>
              Conectá tus wallets
            </h1>
            <p className="mt-2 text-center text-[15px] leading-snug text-muted-foreground">
              Sumá wallets para potenciar tu Lendoor Score, o volvé al teléfono cuando termines.
            </p>

            {/* Cuentas conectadas — Cuenta Lendoor (smart wallet, siempre) +
                wallets externas verificadas. */}
            <div className="mt-7">
              <p className="mb-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                Cuentas conectadas
              </p>
              <div className="rounded-2xl px-4" style={{ background: 'rgba(0,0,0,0.025)' }}>
                {/* Cuenta Lendoor (la que el user ya tiene) */}
                <div className="flex items-center gap-3.5 py-3.5"
                  style={{ borderBottom: wallets.length > 0 ? '1px solid rgba(0,0,0,0.06)' : 'none' }}>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white" style={{ border: '1px solid rgba(0,0,0,0.08)' }}>
                    <img src="/favicon.png" alt="" className="h-6 w-6 object-contain" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold leading-tight" style={{ color: INK }}>Cuenta Lendoor</p>
                    <p className="mt-0.5 text-[13px] font-mono text-muted-foreground">{short(lendoorAddr ?? '')}</p>
                  </div>
                  <CheckCircle2 className="h-[20px] w-[20px] shrink-0" style={{ color: '#22c55e' }} />
                </div>
                {/* Wallets externas verificadas */}
                {wallets.map((w, i) => (
                  <div key={w.address} className="flex items-center gap-3.5 py-3.5"
                    style={{ borderBottom: i === wallets.length - 1 ? 'none' : '1px solid rgba(0,0,0,0.06)' }}>
                    <WalletIcon icon={w.icon} />
                    <p className="min-w-0 flex-1 text-[15px] font-mono" style={{ color: INK }}>{short(w.address)}</p>
                    <CheckCircle2 className="h-[20px] w-[20px] shrink-0" style={{ color: '#22c55e' }} />
                  </div>
                ))}
              </div>
            </div>

            {/* Wallet conectada pero sin verificar todavía */}
            {effConnected && effAddress && !wallets.some((w) => w.address.toLowerCase() === effAddress.toLowerCase()) && (
              <div className="mt-5 rounded-2xl px-4 py-4" style={{ background: 'rgba(249,116,21,0.06)', border: '1px solid rgba(249,116,21,0.22)' }}>
                <div className="flex items-center gap-3">
                  <WalletIcon icon={connectorIcon} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold" style={{ color: INK }}>Wallet conectada</p>
                    <p className="text-[13px] font-mono text-muted-foreground">{short(effAddress)}</p>
                  </div>
                </div>
                <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                  <ShieldCheck className="h-4 w-4 shrink-0" style={{ color: '#22c55e' }} />
                  {busy ? 'Confirmá la firma en tu wallet…' : 'Firmá un mensaje para probar que es tuya. No mueve fondos ni autoriza transacciones.'}
                </p>
              </div>
            )}

            <ErrorMsg error={error} center />

            <div className="mt-7 space-y-3">
              {effConnected && effAddress && !wallets.some((w) => w.address.toLowerCase() === effAddress.toLowerCase()) ? (
                <PrimaryButton onClick={signAndVerify} busy={busy}>
                  {busy ? 'Esperando firma…' : 'Firmar para verificar'}
                </PrimaryButton>
              ) : (
                <PrimaryButton onClick={connectWallet} busy={busy}>
                  {wallets.length > 0 ? 'Conectar otra wallet' : 'Conectar wallet'}
                </PrimaryButton>
              )}
              <button type="button" onClick={logout}
                className="w-full cursor-pointer py-2 text-center text-[14px] font-medium text-muted-foreground transition-opacity active:opacity-60">
                Cerrar sesión
              </button>
            </div>
          </div>
        )}

        {step === 'verifying' && (
          <div className="lk-step-in flex flex-col items-center pt-4 text-center">
            {/* Spinner con anillo naranja — lectura: "analizando on-chain". */}
            <div className="relative flex h-20 w-20 items-center justify-center">
              <div className="absolute inset-0 rounded-full" style={{ border: '3px solid rgba(249,116,21,0.14)' }} />
              <Loader2 className="h-20 w-20 animate-spin" style={{ color: ORANGE, strokeWidth: 1.6 }} />
              <Wallet className="absolute h-7 w-7" style={{ color: ORANGE }} />
            </div>
            <h1 className="mt-6 text-[22px] font-extrabold leading-tight" style={{ color: INK }}>
              Analizando tu wallet
            </h1>
            <p className="mt-2 text-[15px] leading-snug text-muted-foreground">
              Revisamos tu actividad on-chain en todas las redes para potenciar tu Lendoor Score. Tomá unos segundos…
            </p>
            {lastLinked && (
              <div className="mt-6 inline-flex items-center gap-2 rounded-full px-3.5 py-2" style={{ background: 'rgba(0,0,0,0.04)' }}>
                <WalletIcon icon={connectorIcon} small />
                <span className="font-mono text-[13px]" style={{ color: INK }}>{short(lastLinked)}</span>
              </div>
            )}
          </div>
        )}

        {step === 'success' && (
          <div className="lk-step-in flex flex-col items-center pt-6 text-center">
            <SuccessCheck size={72} />
            <h1 className="mt-6 text-[24px] font-extrabold" style={{ color: INK }}>¡Wallet verificada!</h1>
            <p className="mt-2 text-[15px] leading-snug text-muted-foreground">
              {lastLinked && <><span className="font-mono" style={{ color: INK }}>{short(lastLinked)}</span> quedó conectada y ya suma para tu score. </>}
              Ya podés volver a la app.
            </p>
            <div className="mt-8 w-full space-y-3">
              <PrimaryButton onClick={() => setStep('wallets')}>Listo</PrimaryButton>
            </div>
          </div>
        )}

        {demo && (
          <p className="mt-8 text-center text-[11px] text-muted-foreground/60">modo demo — sin backend</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Centered({ title, subtitle, onBack, children }: { title: string; subtitle: React.ReactNode; onBack?: () => void; children: React.ReactNode }) {
  return (
    <div>
      {onBack && (
        <button type="button" onClick={onBack}
          className="mb-3 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full transition-transform active:scale-95"
          style={{ background: 'rgba(0,0,0,0.04)' }} aria-label="Volver">
          <ArrowLeft className="h-5 w-5" style={{ color: INK }} />
        </button>
      )}
      <h1 className="text-[24px] font-extrabold leading-tight" style={{ color: INK }}>{title}</h1>
      <p className="mt-2 mb-6 text-[15px] leading-snug text-muted-foreground">{subtitle}</p>
      {children}
    </div>
  );
}

function PrimaryButton({ onClick, busy, children }: { onClick: () => void; busy?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={busy}
      className="mt-4 flex h-[54px] w-full cursor-pointer items-center justify-center gap-2 rounded-full text-[16px] font-semibold text-white transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
      style={{ backgroundColor: ORANGE, boxShadow: '0 6px 20px rgba(249,116,21,0.30)' }}>
      {busy && <Loader2 className="h-5 w-5 animate-spin" />}
      {children}
    </button>
  );
}

function WalletIcon({ icon, small }: { icon?: string; small?: boolean }) {
  const [failed, setFailed] = React.useState(false);
  const box = small ? 'h-6 w-6' : 'h-10 w-10';
  const img = small ? 'h-4 w-4' : 'h-6 w-6';
  const fb = small ? 'h-3.5 w-3.5' : 'h-5 w-5';
  return (
    <div className={`flex ${box} shrink-0 items-center justify-center overflow-hidden rounded-full bg-white`}
      style={{ border: '1px solid rgba(0,0,0,0.08)' }}>
      {icon && !failed
        ? <img src={icon} alt="" className={`${img} object-contain`} onError={() => setFailed(true)} />
        : <Wallet className={fb} style={{ color: ORANGE }} />}
    </div>
  );
}

// Tilde verde animado (círculo con pop + check dibujándose + halo). Reusable en
// OTP-correcto y en la pantalla de wallet verificada.
function SuccessCheck({ size = 64 }: { size?: number }) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <span className="lk-ring absolute inset-0 rounded-full" style={{ background: 'rgba(34,197,94,0.45)' }} />
      <svg className="lk-pop relative" width={size} height={size} viewBox="0 0 52 52" aria-hidden>
        <circle cx="26" cy="26" r="26" fill="#22c55e" />
        <path className="lk-draw" d="M15 27 l7.5 7.5 L37.5 19" fill="none" stroke="#fff" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function ErrorMsg({ error, center }: { error: string | null; center?: boolean }) {
  if (!error) return null;
  return <p className={`mt-3 text-[13px] font-medium ${center ? 'text-center' : ''}`} style={{ color: '#ef4444' }}>{error}</p>;
}

function dedupe(ws: LinkedWallet[]): LinkedWallet[] {
  const seen = new Set<string>();
  return ws.filter((w) => { const k = w.address.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

function wait(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
