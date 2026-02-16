import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Bell, Gift, Plus, Sparkles, X } from "lucide-react"
import type { DepositBonusStatus, SignupBonusStatus } from "../../api"
import type { Lang, MarketNewsEvent, Metrics, TradingAccount } from "../../types"
import ActiveAccountCard from "../../components/accounts/ActiveAccountCard"
import AccountsSwitcherSheet from "../../components/accounts/AccountsSwitcherSheet"
import AccountFundingModal from "../../components/accounts/AccountFundingModal"
import AccountDetailsModal from "../../components/accounts/AccountDetailsModal"
import AccountCreationModal from "../../components/accounts/AccountCreationModal"
import RealDepositRequestModal from "../../components/accounts/RealDepositRequestModal"
import RealWithdrawRequestModal from "../../components/accounts/RealWithdrawRequestModal"
import type { AccountSnapshot } from "../../components/accounts/types"
import { t } from "../../utils/i18n"
import { useAnimatedPresence } from "../../hooks/useAnimatedPresence"
import "./AccountsPage.css"

interface AccountsPageProps {
  lang: Lang
  accounts: TradingAccount[]
  activeAccountId: string
  metrics: Metrics
  activeOpenOrdersCount: number
  liveDataReady: boolean
  snapshots: Record<string, AccountSnapshot>
  onSwitch: (accountId: string) => Promise<void>
  onCreate: (payload: { plan_id: string; mode: "demo" | "real"; name?: string; is_active?: boolean }) => Promise<void>
  onUpdateLeverage: (accountId: string, leverage: number) => Promise<void>
  onRenameAccount: (accountId: string, name: string) => Promise<void>
  onTopUpDemo: (amount: string) => Promise<void>
  onWithdrawDemo: (amount: string) => Promise<void>
  signupBonus: SignupBonusStatus | null
  depositBonus: DepositBonusStatus | null
  onClaimSignupBonus: () => Promise<void>
  onRequestRealDeposit: (payload: {
    amountUSD: string
    voucherKind: "none" | "gold" | "diamond"
    methodID: string
    proofFile: File
  }) => Promise<void>
  onRequestRealWithdraw: (payload: {
    amountUSD: string
    methodID: string
    payoutDetails: string
  }) => Promise<void>
  newsUpcoming: MarketNewsEvent[]
  onCloseAll: () => Promise<void>
  onGoTrade: () => void
  hasUnreadNotifications: boolean
  onOpenNotifications: () => void
}

type FundingType = "deposit" | "withdraw" | null
type VoucherKind = "none" | "gold" | "diamond"

const normalizeVoucherKind = (value?: string): VoucherKind => {
  const v = String(value || "").trim().toLowerCase()
  if (v === "gold" || v === "diamond") return v
  return "none"
}

const voucherLabel = (kind: VoucherKind) => {
  if (kind === "gold") return "accounts.voucher.gold"
  if (kind === "diamond") return "accounts.voucher.diamond"
  return "accounts.voucher.deposit"
}

const formatNewsTime = (raw: string, lang: Lang) => {
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return "—"
  const locale = lang === "ru" ? "ru-RU" : lang === "uz" ? "uz-UZ" : "en-GB"
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d)
}

const normalizeImpact = (impact: string) => {
  const value = String(impact || "").toLowerCase()
  if (value === "high" || value === "medium" || value === "low") return value
  return "medium"
}

const newsImpactText = (impact: string) => {
  const value = normalizeImpact(impact)
  if (value === "high") return "accounts.news.impact.high"
  if (value === "low") return "accounts.news.impact.low"
  return "accounts.news.impact.medium"
}

const newsStatusText = (status: string) => {
  const value = String(status || "").toLowerCase()
  if (value === "live") return "accounts.news.status.live"
  if (value === "pre") return "accounts.news.status.pre"
  if (value === "post") return "accounts.news.status.post"
  return "accounts.news.status.scheduled"
}

const formatNewsNumber = (value?: number | null) => {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return "0.00"
  return n.toFixed(2)
}

export default function AccountsPage({
  lang,
  accounts,
  activeAccountId,
  metrics,
  activeOpenOrdersCount,
  liveDataReady,
  snapshots,
  onSwitch,
  onCreate,
  onUpdateLeverage,
  onRenameAccount,
  onTopUpDemo,
  onWithdrawDemo,
  signupBonus,
  depositBonus,
  onClaimSignupBonus,
  onRequestRealDeposit,
  onRequestRealWithdraw,
  newsUpcoming,
  onCloseAll,
  onGoTrade,
  hasUnreadNotifications,
  onOpenNotifications,
}: AccountsPageProps) {
  const activeAccount = useMemo(() => {
    return accounts.find(a => a.id === activeAccountId) || accounts.find(a => a.is_active) || null
  }, [accounts, activeAccountId])

  const activeSnapshot = useMemo<AccountSnapshot | null>(() => {
    if (!activeAccount) return null
    const fromMap = snapshots[activeAccount.id] || null
    const useLive = liveDataReady
    const livePl = Number(metrics.pl || 0)
    const safeLivePl = Number.isFinite(livePl) ? livePl : 0
    const pl = useLive ? safeLivePl : (fromMap?.pl ?? safeLivePl)
    const openCount = useLive
      ? (Number.isFinite(activeOpenOrdersCount) ? activeOpenOrdersCount : 0)
      : (fromMap?.openCount ?? (Number.isFinite(activeOpenOrdersCount) ? activeOpenOrdersCount : 0))
    return {
      pl,
      openCount,
      metrics: useLive ? metrics : (fromMap?.metrics || null)
    }
  }, [activeAccount, snapshots, metrics, activeOpenOrdersCount, liveDataReady])

  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [fundingOpen, setFundingOpen] = useState<FundingType>(null)
  const [fundingAmount, setFundingAmount] = useState("1000")
  const [fundingBusy, setFundingBusy] = useState(false)
  const [fundingVoucherKind, setFundingVoucherKind] = useState<VoucherKind>("none")
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [bonusModalOpen, setBonusModalOpen] = useState(false)
  const [bonusAccepted, setBonusAccepted] = useState(false)
  const [bonusBusy, setBonusBusy] = useState(false)
  const { shouldRender: bonusModalRender, isVisible: bonusModalVisible } = useAnimatedPresence(bonusModalOpen, 220)

  const showSignupBonus = !!signupBonus && !signupBonus.claimed && signupBonus.can_claim
  const signupBonusAmount = signupBonus?.amount || "10.00"

  const switcherSnapshots = useMemo(() => {
    if (!activeAccount || !activeSnapshot) return snapshots
    return {
      ...snapshots,
      [activeAccount.id]: activeSnapshot
    }
  }, [snapshots, activeAccount, activeSnapshot])

  const isRealStandard = activeAccount?.mode === "real" && activeAccount?.plan_id === "standard"
  const voucherCards = useMemo(() => {
    return (depositBonus?.vouchers || [])
      .map(v => ({
        id: normalizeVoucherKind(v.id),
        title: v.title,
        percent: Number(v.percent || "0"),
        available: Boolean(v.available && !v.used),
      }))
      .filter(v => v.id === "gold" || v.id === "diamond")
  }, [depositBonus])
  const voucherLocked = (depositBonus?.pending_count || 0) > 0
  const showBonusRail = showSignupBonus || (isRealStandard && voucherCards.length > 0)

  const openRealDeposit = (voucher: VoucherKind) => {
    if (!isRealStandard) {
      toast.error(t("accounts.errors.switchRealStandard", lang))
      return
    }
    setFundingVoucherKind(voucher)
    setFundingOpen("deposit")
  }

  if (!activeAccount) {
    return (
      <div className="accounts-page">
        <div className="accounts-header">
          <h1 className="accounts-title">{t("accounts", lang)}</h1>
          <div className="accounts-header-actions">
            <button
              type="button"
              className="accounts-notif-btn"
              onClick={onOpenNotifications}
              aria-label={t("accounts.openNotifications", lang)}
            >
              <Bell size={18} />
              {hasUnreadNotifications ? <span className="accounts-notif-dot" /> : null}
            </button>
            <button
              onClick={() => setCreateModalOpen(true)}
              className="add-account-btn"
            >
              <Plus size={24} />
            </button>
          </div>
        </div>

        <section className="acc-active-card">
          <h2>{t("accounts.noAccounts", lang)}</h2>
          <p className="acc-note">{t("accounts.noAccountsHint", lang)}</p>
        </section>

        <AccountCreationModal
          lang={lang}
          open={createModalOpen}
          onClose={() => setCreateModalOpen(false)}
          onCreate={onCreate}
        />
      </div>
    )
  }

  const isRealDepositFlow = fundingOpen === "deposit" && activeAccount.mode === "real"
  const isRealWithdrawFlow = fundingOpen === "withdraw" && activeAccount.mode === "real"

  if (fundingOpen) {
    if (isRealDepositFlow) {
      return (
        <div className="accounts-page pb-24">
          <RealDepositRequestModal
            lang={lang}
            open
            layout="page"
            status={depositBonus}
            allowVouchers={isRealStandard}
            defaultVoucher={fundingVoucherKind}
            loading={fundingBusy}
            onClose={() => {
              if (fundingBusy) return
              setFundingOpen(null)
              setFundingVoucherKind("none")
            }}
            onSubmit={async (payload) => {
              setFundingBusy(true)
              try {
                await onRequestRealDeposit(payload)
                toast.success(t("accounts.requestSubmittedReview", lang))
                setFundingOpen(null)
                setFundingVoucherKind("none")
              } catch (err: any) {
                toast.error(err?.message || t("accounts.errors.submitFailed", lang))
              } finally {
                setFundingBusy(false)
              }
            }}
          />
        </div>
      )
    }

    if (isRealWithdrawFlow) {
      return (
        <div className="accounts-page pb-24">
          <RealWithdrawRequestModal
            lang={lang}
            open
            layout="page"
            status={depositBonus}
            loading={fundingBusy}
            onClose={() => {
              if (fundingBusy) return
              setFundingOpen(null)
              setFundingVoucherKind("none")
            }}
            onSubmit={async (payload) => {
              setFundingBusy(true)
              try {
                await onRequestRealWithdraw(payload)
                toast.success(t("accounts.withdrawCompleted", lang))
                setFundingOpen(null)
                setFundingVoucherKind("none")
              } catch (err: any) {
                toast.error(err?.message || t("accounts.errors.submitFailed", lang))
              } finally {
                setFundingBusy(false)
              }
            }}
          />
        </div>
      )
    }

    return (
      <div className="accounts-page pb-24">
        <AccountFundingModal
          lang={lang}
          open
          layout="page"
          mode={activeAccount.mode as "demo" | "real"}
          type={fundingOpen}
          amount={fundingAmount}
          onAmountChange={setFundingAmount}
          onClose={() => setFundingOpen(null)}
          loading={fundingBusy}
          onSubmit={async () => {
            if (!fundingOpen) return
            if (!fundingAmount || Number(fundingAmount) <= 0) {
              toast.error(t("accounts.errors.enterValidAmount", lang))
              return
            }
            setFundingBusy(true)
            try {
              if (fundingOpen === "deposit") {
                await onTopUpDemo(fundingAmount)
                toast.success(t("accounts.depositCompleted", lang))
              } else {
                await onWithdrawDemo(fundingAmount)
                toast.success(t("accounts.withdrawCompleted", lang))
              }
              setFundingOpen(null)
            } catch (err: any) {
              toast.error(err?.message || t("accounts.errors.operationFailed", lang))
            } finally {
              setFundingBusy(false)
            }
          }}
        />
      </div>
    )
  }

  return (
    <div className="accounts-page pb-24">
      <div className="accounts-header">
        <h1 className="accounts-title">{t("accounts", lang)}</h1>
        <div className="accounts-header-actions">
          <button
            type="button"
            className="accounts-notif-btn"
            onClick={onOpenNotifications}
            aria-label={t("accounts.openNotifications", lang)}
          >
            <Bell size={18} />
            {hasUnreadNotifications ? <span className="accounts-notif-dot" /> : null}
          </button>
          <button
            onClick={() => setCreateModalOpen(true)}
            className="add-account-btn"
          >
            <Plus size={20} />
          </button>
        </div>
      </div>

      {showBonusRail && (
        <section className="accounts-bonus-rail-wrap">
          <div className="accounts-bonus-rail">
            {showSignupBonus && (
              <article className="accounts-bonus-card accounts-bonus-card-welcome">
                <div className="accounts-bonus-chip">
                  <Gift size={14} />
                  <span>{t("accounts.welcome", lang)}</span>
                </div>
                <div className="accounts-bonus-amount">+${signupBonusAmount}</div>
                <p className="accounts-bonus-text">{t("accounts.welcomeHint", lang)}</p>
                <button
                  type="button"
                  className="accounts-bonus-claim-btn"
                  onClick={() => setBonusModalOpen(true)}
                >
                  {t("accounts.claimBonus", lang)}
                </button>
              </article>
            )}

            {isRealStandard && voucherCards.map(voucher => {
              const disabled = !voucher.available || voucherLocked
              const actionLabel = voucherLocked
                ? t("accounts.pendingReview", lang)
                : voucher.available
                  ? voucher.id === "diamond"
                    ? t("accounts.useFrom200", lang)
                    : t("accounts.useOnDeposit", lang)
                  : t("accounts.used", lang)
              return (
                <article key={voucher.id} className="accounts-bonus-card accounts-bonus-card-voucher">
                  <div className="accounts-bonus-chip">
                    <Sparkles size={14} />
                    <span>{t(voucherLabel(voucher.id), lang)}</span>
                  </div>
                  <div className="accounts-bonus-amount">+{voucher.percent}%</div>
                  <p className="accounts-bonus-text">
                    {voucher.id === "diamond"
                      ? t("accounts.voucherDiamondHint", lang)
                      : t("accounts.voucherOnceHint", lang)}
                  </p>
                  <button
                    type="button"
                    className="accounts-bonus-claim-btn"
                    disabled={disabled}
                    onClick={() => openRealDeposit(voucher.id)}
                  >
                    {actionLabel}
                  </button>
                </article>
              )
            })}
          </div>

          {isRealStandard && (depositBonus?.pending_count || 0) > 0 && (
            <div className="accounts-bonus-note">
              {t("accounts.pendingRequests", lang).replace("{count}", String(depositBonus?.pending_count || 0))}
            </div>
          )}
        </section>
      )}

      <ActiveAccountCard
        lang={lang}
        account={activeAccount}
        snapshot={activeSnapshot || { pl: 0, openCount: 0, metrics: null }}
        loadingBalance={!liveDataReady && !activeSnapshot?.metrics}
        switcherOpen={switcherOpen}
        onToggleSwitcher={() => setSwitcherOpen(v => !v)}
        onTrade={onGoTrade}
        onDeposit={() => {
          setFundingVoucherKind("none")
          setFundingOpen("deposit")
        }}
        onWithdraw={() => {
          setFundingVoucherKind("none")
          setFundingOpen("withdraw")
        }}
        onDetails={() => setDetailsOpen(true)}
      />

      {newsUpcoming.length > 0 && (
        <section className="accounts-news-rail-wrap">
          <div className="accounts-news-rail-title-row">
            <h3 className="accounts-news-rail-title">{t("accounts.marketCalendar", lang)}</h3>
            <span className="accounts-news-rail-subtitle">{t("accounts.timezone", lang)}</span>
          </div>
          <div className="accounts-news-rail">
            {newsUpcoming.slice(0, 3).map(item => {
              const impact = normalizeImpact(item.impact)
              return (
                <article key={item.id} className={`accounts-news-card impact-${impact}`}>
                  <div className="accounts-news-card-top">
                    <span className={`accounts-news-impact impact-${impact}`}>{t(newsImpactText(impact), lang)}</span>
                    <span className="accounts-news-status">{t(newsStatusText(item.status), lang)}</span>
                  </div>
                  <h4 className="accounts-news-title">{item.title}</h4>
                  <div className="accounts-news-time">{formatNewsTime(item.scheduled_at, lang)}</div>
                  <div className="accounts-news-values">
                    <span>{t("accounts.news.valueForecast", lang)}: {formatNewsNumber(item.forecast_value)}</span>
                    {item.actual_value != null
                      ? <span>{t("accounts.news.valueActual", lang)}: {formatNewsNumber(item.actual_value)}</span>
                      : <span>{t("accounts.news.valueActual", lang)}: —</span>}
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      )}

      <AccountsSwitcherSheet
        lang={lang}
        open={switcherOpen}
        accounts={accounts}
        activeAccountId={activeAccountId}
        snapshots={switcherSnapshots}
        onClose={() => setSwitcherOpen(false)}
        onSwitch={onSwitch}
      />

      <AccountDetailsModal
        lang={lang}
        open={detailsOpen}
        account={activeAccount}
        snapshot={activeSnapshot}
        onClose={() => setDetailsOpen(false)}
        onCloseAll={onCloseAll}
        onRename={onRenameAccount}
        onUpdateLeverage={onUpdateLeverage}
      />

      <AccountCreationModal
        lang={lang}
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreate={onCreate}
      />

      {bonusModalRender && (
        <div className={`accounts-bonus-modal ${bonusModalVisible ? "is-open" : "is-closing"}`} onClick={() => {
          if (bonusBusy) return
          setBonusModalOpen(false)
          setBonusAccepted(false)
        }}>
          <div className="accounts-bonus-backdrop" />
          <div className="accounts-bonus-sheet" onClick={e => e.stopPropagation()}>
            <div className="accounts-bonus-sheet-head">
              <h3>{t("accounts.claimWelcomeBonus", lang)}</h3>
              <button
                type="button"
                className="accounts-bonus-close"
              onClick={() => {
                if (bonusBusy) return
                setBonusModalOpen(false)
                setBonusAccepted(false)
              }}
            >
              <X size={18} />
            </button>
          </div>
          <div className="accounts-bonus-sheet-body">
            <p className="accounts-bonus-sheet-text">
                {t("accounts.welcomeModalText", lang).replace("{amount}", String(signupBonusAmount))}
            </p>
            <ul className="accounts-bonus-terms">
                <li>{t("accounts.welcomeRuleOne", lang)}</li>
                <li>{t("accounts.welcomeRuleLimit", lang).replace("{limit}", String(signupBonus?.total_limit || 700))}</li>
                <li>{t("accounts.welcomeRuleRemaining", lang).replace("{remaining}", String(signupBonus?.remaining ?? 0))}</li>
                <li>{t("accounts.welcomeRuleTradable", lang)}</li>
            </ul>
            <label className="accounts-bonus-agree">
                <input
                  type="checkbox"
                  checked={bonusAccepted}
                  onChange={e => setBonusAccepted(e.target.checked)}
                  disabled={bonusBusy}
                />
                <span>{t("accounts.agreeTerms", lang)}</span>
              </label>
            </div>
            <div className="accounts-bonus-sheet-foot">
              <button
                type="button"
                className="accounts-bonus-submit"
                disabled={!bonusAccepted || bonusBusy}
                onClick={async () => {
                  if (!bonusAccepted || bonusBusy) return
                  setBonusBusy(true)
                  try {
                    await onClaimSignupBonus()
                    toast.success(t("accounts.bonusClaimed", lang))
                    setBonusModalOpen(false)
                    setBonusAccepted(false)
                  } catch (err: any) {
                    toast.error(err?.message || t("accounts.errors.claimFailed", lang))
                  } finally {
                    setBonusBusy(false)
                  }
                }}
              >
                {bonusBusy ? t("accounts.claiming", lang) : t("accounts.claimAmountBonus", lang).replace("{amount}", String(signupBonusAmount))}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
