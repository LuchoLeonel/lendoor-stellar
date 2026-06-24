'use client'

import { useState, type ChangeEvent, type FocusEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useApproveAndDepositUSDC } from '@/hooks/lend/useApproveAndDepositUSDC'
import { useWithdrawUSDC } from '@/hooks/lend/useWithdrawUSDC'
import { useUsdcBalance } from '@/hooks/useUsdcBalance'
import { useVaultStats } from '@/hooks/lend/useVaultStats'
import { useVaultShares } from '@/hooks/lend/useVaultShares'
import { useWallet } from '@/providers/WalletProvider'
import { useVaultApy15d } from '@/hooks/useVaultApy15d'
import { VaultActivityList } from '@/components/lend/VaultActivityList'
import { UsdcIcon } from '@/components/icons/UsdcIcon'
import { SpotlightCard } from '@/components/reactbits/SpotlightCard'
import { AnimatedContent } from '@/components/reactbits/AnimatedContent'

type Mode = 'deposit' | 'withdraw'

const ORANGE_BTN_SHADOW = '0 4px 16px rgba(249,116,21,0.25)'

export function LendMarket() {
  const { t } = useTranslation()

  const { isLoggedIn, loadingNetwork, setShowAuthFlow } = useWallet()
  const [mode, setMode] = useState<Mode>('deposit')

  // Si no lo usás en UI, podés comentar
  useVaultApy15d()

  const { submit: submitDeposit, submitting: submittingDeposit } =
    useApproveAndDepositUSDC()

  const {
    submit: submitWithdraw,
    submitting: submittingWithdraw,
    availableUi,
  } = useWithdrawUSDC()

  const { display: usdcBalanceDisplay } = useUsdcBalance()
  const { raw: userSharesRaw, display: userSharesDisplay } = useVaultShares()

  const {
    totalAssetsDisplay,
    sharePriceDisplay,
    sharePrice,
    loading: loadingVault,
  } = useVaultStats()

  const SHARE_DECIMALS = 6
  const userShares =
    userSharesRaw != null ? Number(userSharesRaw) / 10 ** SHARE_DECIMALS : 0

  const userSharesUsd =
    userSharesRaw != null && sharePrice != null ? userShares * sharePrice : 0

  const supplyCap = 10_000

  const [amount, setAmount] = useState<number>(0)
  const [amountInput, setAmountInput] = useState<string>('0.00')

  const handleConnect = () => setShowAuthFlow()

  const handleAmountChange = (e: ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value
    value = value.replace(/[^0-9.,]/g, '')

    const parts = value.split(/[.,]/)
    if (parts.length > 2) return

    setAmountInput(value)

    const normalized = value.replace(',', '.')
    if (normalized === '' || normalized === '.' || normalized === ',') {
      setAmount(0)
      return
    }

    const num = Number(normalized)
    if (Number.isNaN(num) || num < 0) return

    setAmount(num)
  }

  const handleAmountFocus = (e: FocusEvent<HTMLInputElement>) => {
    if (amountInput === '0.00' || amountInput === '0,00' || amountInput === '0') {
      setAmountInput('')
    }
    if (e.target.select) e.target.select()
  }

  const handleAmountBlur = () => {
    const normalized = amountInput.replace(',', '.').trim()

    if (
      !normalized ||
      normalized === '.' ||
      normalized === ',' ||
      Number.isNaN(Number(normalized)) ||
      Number(normalized) <= 0
    ) {
      setAmount(0)
      setAmountInput('0.00')
      return
    }

    const num = Number(normalized)
    setAmount(num)
    setAmountInput(num.toFixed(2))
  }

  const safeAvailable =
    typeof availableUi === 'number' && Number.isFinite(availableUi)
      ? availableUi
      : 0

  const handleAction = async () => {
    if (!isLoggedIn) return handleConnect()
    if (amount <= 0) return

    const normalized = amountInput.replace(',', '.').trim()

    if (mode === 'deposit') {
      const ok = await submitDeposit(normalized)
      if (ok) {
        setAmount(0)
        setAmountInput('0.00')
      }
    } else {
      const ok = await submitWithdraw(normalized)
      if (ok) {
        setAmount(0)
        setAmountInput('0.00')
      }
    }
  }

  const isDeposit = mode === 'deposit'
  const submitting = isDeposit ? submittingDeposit : submittingWithdraw

  const primaryLabel = !isLoggedIn
    ? t('lend.market.cta.connect')
    : submitting
      ? t('lend.market.cta.submitting')
      : isDeposit
        ? t('lend.market.cta.deposit')
        : t('lend.market.cta.withdraw')

  const isActionDisabled = loadingNetwork || submitting || amount <= 0

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex justify-center px-4 py-4">
        <div className="w-full max-w-5xl mx-auto min-w-0">
          <div
            className="
              max-w-2xl mx-auto
              flex flex-col gap-4
            "
          >
            {/* Page title */}
            <AnimatedContent delay={0}>
              <div className="flex-none">
                <h1 className="text-2xl font-bold text-foreground">
                  {t('lend.market.vaultTitle')}
                </h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {t('lend.market.vaultSubtitle')}
                </p>
              </div>
            </AnimatedContent>

            {/* Stats cards */}
            <AnimatedContent delay={0.05}>
            <div className="grid gap-3 sm:grid-cols-2 flex-none">
              {/* Your Shares */}
              <SpotlightCard className="p-5 md:p-6 space-y-1">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                  {t('lend.market.yourShares')}
                </p>
                <p className="text-2xl md:text-3xl font-bold text-foreground font-mono">
                  {loadingVault ? '—' : `$${userSharesUsd.toFixed(2)}`}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {userSharesDisplay !== '—'
                    ? t('lend.market.sharesLabel', { shares: userSharesDisplay })
                    : t('lend.market.sharesZero')}
                </p>
              </SpotlightCard>

              {/* Total Assets */}
              <SpotlightCard className="p-5 md:p-6 space-y-1">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                  {t('lend.market.totalAssets')}
                </p>
                <p className="text-2xl md:text-3xl font-bold text-foreground font-mono">
                  {loadingVault ? '—' : `$${totalAssetsDisplay}`}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {loadingVault
                    ? '—'
                    : t('lend.market.sharePriceLabel', { price: sharePriceDisplay })}
                </p>
              </SpotlightCard>
            </div>
            </AnimatedContent>

            {/* Manage shares */}
            <AnimatedContent delay={0} distance={16}>
            <div className="rounded-xl border border-border/50 bg-background p-5 md:p-6 space-y-4 shadow-sm">
              <h2 className="text-sm font-medium text-foreground">
                {t('lend.market.manageShares')}
              </h2>

              {/* Tabs */}
              <div className="inline-flex rounded-full bg-muted p-1 text-xs">
                <button
                  onClick={() => setMode('deposit')}
                  className={`px-4 py-1.5 min-h-[44px] flex items-center rounded-full cursor-pointer transition-all font-medium ${
                    mode === 'deposit'
                      ? 'bg-background shadow-sm text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t('lend.market.tabDeposit')}
                </button>

                <button
                  onClick={() => setMode('withdraw')}
                  className={`px-4 py-1.5 min-h-[44px] flex items-center rounded-full cursor-pointer transition-all font-medium ${
                    mode === 'withdraw'
                      ? 'bg-background shadow-sm text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t('lend.market.tabWithdraw')}
                </button>
              </div>

              {/* Amount */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                  <span>{t('lend.market.amountLabel')}</span>
                  {isDeposit ? (
                    <span>
                      {t('lend.market.balanceLabel', { balance: usdcBalanceDisplay })}
                    </span>
                  ) : (
                    <span>
                      {t('lend.market.availableLabel', {
                        available: safeAvailable.toFixed(2),
                      })}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 rounded-2xl border border-border px-4 py-3 bg-muted/30 focus-within:border-primary/50 transition-colors">
                  <input
                    type="text"
                    inputMode="decimal"
                    className="flex-1 bg-transparent outline-none text-base text-foreground placeholder:text-muted-foreground"
                    value={amountInput}
                    onChange={handleAmountChange}
                    onFocus={handleAmountFocus}
                    onBlur={handleAmountBlur}
                    placeholder="0.00"
                  />

                  <span className="flex items-center justify-center">
                    <UsdcIcon size={19} />
                  </span>
                </div>
              </div>

              {/* Primary CTA */}
              <button
                onClick={handleAction}
                disabled={isActionDisabled}
                className="
                  w-full h-[52px] rounded-2xl
                  disabled:opacity-50 disabled:cursor-not-allowed
                  text-white font-semibold text-[15px]
                  flex items-center justify-center
                  active:scale-[0.98] transition-all cursor-pointer
                "
                style={{
                  backgroundColor: '#F97415',
                  boxShadow: isActionDisabled ? 'none' : ORANGE_BTN_SHADOW,
                }}
              >
                {loadingNetwork ? t('lend.market.processing') : primaryLabel}
              </button>

              <p className="text-[11px] text-muted-foreground">
                {t('lend.market.supplyCapCopy', {
                  cap: supplyCap.toLocaleString(),
                })}
              </p>
            </div>
            </AnimatedContent>

            {/* Vault activity */}
            <AnimatedContent delay={0} distance={16}>
            <div className="relative rounded-xl border border-border bg-card shadow-sm p-5 md:p-6 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-foreground">
                  {t('lend.market.vaultActivity')}
                </h3>
              </div>

              <div className="rounded-2xl bg-muted/30 p-2">
                <VaultActivityList />
              </div>
            </div>
            </AnimatedContent>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
