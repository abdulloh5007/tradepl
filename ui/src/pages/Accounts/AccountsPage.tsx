import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Bell, Gift, Plus, Share2, ShieldCheck, Sparkles, X } from "lucide-react"
import type { DepositBonusStatus, KYCStatus, ReferralStatus, SignupBonusStatus } from "../../api"
import type { Metrics, TradingAccount } from "../../types"
import ActiveAccountCard from "../../components/accounts/ActiveAccountCard"
import AccountsSwitcherSheet from "../../components/accounts/AccountsSwitcherSheet"
import AccountFundingModal from "../../components/accounts/AccountFundingModal"
import AccountDetailsModal from "../../components/accounts/AccountDetailsModal"
import AccountCreationModal from "../../components/accounts/AccountCreationModal"
import RealDepositRequestModal from "../../components/accounts/RealDepositRequestModal"
import KYCVerificationModal from "../../components/accounts/KYCVerificationModal"
import type { AccountSnapshot } from "../../components/accounts/types"
import "./AccountsPage.css"

interface AccountsPageProps {
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
    proofFile: File
  }) => Promise<void>
  kycStatus: KYCStatus | null
  onRequestKYC: (payload: {
    documentType: "passport" | "id_card" | "driver_license" | "other"
    fullName: string
    documentNumber: string
    residenceAddress: string
    notes?: string
    proofFile: File
  }) => Promise<void>
  referralStatus: ReferralStatus | null
  onReferralWithdraw: (amountUSD?: string) => Promise<void>
  onRefreshReferral: () => Promise<void> | void
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
  if (kind === "gold") return "Gold bonus"
  if (kind === "diamond") return "Diamond bonus"
  return "Deposit bonus"
}

const formatDuration = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds))
  const days = Math.floor(safe / 86400)
  const hours = Math.floor((safe % 86400) / 3600)
  const mins = Math.floor((safe % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h ${mins}m`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

export default function AccountsPage({
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
  kycStatus,
  onRequestKYC,
  referralStatus,
  onReferralWithdraw,
  onRefreshReferral,
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
  const [kycModalOpen, setKycModalOpen] = useState(false)
  const [kycBusy, setKycBusy] = useState(false)
  const [referralBusy, setReferralBusy] = useState(false)

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
  const kycState = String(kycStatus?.state || "unavailable")
  const kycPending = kycState === "pending"
  const kycApproved = kycState === "approved" || Boolean(kycStatus?.claimed)
  const kycBlockedTemp = kycState === "blocked_temp"
  const kycBlockedPermanent = kycState === "blocked_permanent"
  const kycBlockedSeconds = Number(kycStatus?.blocked_seconds || 0)
  const kycBlockedLabel = kycBlockedTemp && kycBlockedSeconds > 0 ? formatDuration(kycBlockedSeconds) : ""
  const kycBonusAmount = String(kycStatus?.bonus_amount_usd || "50.00")
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
      toast.error("Switch to Real Standard account")
      return
    }
    setFundingVoucherKind(voucher)
    setFundingOpen("deposit")
  }

  const openKYCModal = () => {
    if (!isRealStandard) {
      toast.error("Switch to active Real Standard account")
      return
    }
    if (!kycStatus?.can_submit) {
      toast.error(kycStatus?.message || "KYC submission is unavailable")
      return
    }
    setKycModalOpen(true)
  }

  const handleShareReferral = () => {
    if (!referralStatus?.share_url) {
      toast.error("Referral link is unavailable")
      return
    }
    const text = "Join LV Trade with my referral link."
    const shareURL = `https://t.me/share/url?url=${encodeURIComponent(referralStatus.share_url)}&text=${encodeURIComponent(text)}`
    try {
      if (window.Telegram?.WebApp?.openTelegramLink) {
        window.Telegram.WebApp.openTelegramLink(shareURL)
        return
      }
    } catch {
      // fallback below
    }
    window.open(shareURL, "_blank", "noopener,noreferrer")
  }

  const handleWithdrawReferral = async () => {
    if (!referralStatus) return
    if (referralStatus.real_account_required) {
      toast.error("Create a real account first")
      return
    }
    if (!referralStatus.can_withdraw) {
      toast.error(`Minimum referral balance for withdraw is ${referralStatus.min_withdraw_usd} USD`)
      return
    }
    const raw = window.prompt(
      `Withdraw amount in USD (min ${referralStatus.min_withdraw_usd}). Leave empty to withdraw full balance.`,
      referralStatus.balance
    )
    if (raw === null) return
    const amount = String(raw || "").trim()
    setReferralBusy(true)
    try {
      await onReferralWithdraw(amount || undefined)
      await onRefreshReferral()
      toast.success("Referral withdrawal completed")
    } catch (err: any) {
      toast.error(err?.message || "Referral withdrawal failed")
    } finally {
      setReferralBusy(false)
    }
  }

  if (!activeAccount) {
    return (
      <div className="accounts-page">
        <div className="accounts-header">
          <h1 className="accounts-title">Accounts</h1>
          <div className="accounts-header-actions">
            <button
              type="button"
              className="accounts-notif-btn"
              onClick={onOpenNotifications}
              aria-label="Open notifications"
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
          <h2>No accounts</h2>
          <p className="acc-note">Create your first account to start trading.</p>
        </section>

        <AccountCreationModal
          open={createModalOpen}
          onClose={() => setCreateModalOpen(false)}
          onCreate={onCreate}
        />
      </div>
    )
  }

  const isRealDepositFlow = fundingOpen === "deposit" && activeAccount.mode === "real"

  return (
    <div className="accounts-page pb-24">
      <div className="accounts-header">
        <h1 className="accounts-title">Accounts</h1>
        <div className="accounts-header-actions">
          <button
            type="button"
            className="accounts-notif-btn"
            onClick={onOpenNotifications}
            aria-label="Open notifications"
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
                  <span>Welcome</span>
                </div>
                <div className="accounts-bonus-amount">+${signupBonusAmount}</div>
                <p className="accounts-bonus-text">Real Standard only, one-time reward.</p>
                <button
                  type="button"
                  className="accounts-bonus-claim-btn"
                  onClick={() => setBonusModalOpen(true)}
                >
                  Claim bonus
                </button>
              </article>
            )}

            {isRealStandard && voucherCards.map(voucher => {
              const disabled = !voucher.available || voucherLocked
              const actionLabel = voucherLocked
                ? "Pending review"
                : voucher.available
                  ? voucher.id === "diamond"
                    ? "Use from $200"
                    : "Use on deposit"
                  : "Used"
              return (
                <article key={voucher.id} className="accounts-bonus-card accounts-bonus-card-voucher">
                  <div className="accounts-bonus-chip">
                    <Sparkles size={14} />
                    <span>{voucherLabel(voucher.id)}</span>
                  </div>
                  <div className="accounts-bonus-amount">+{voucher.percent}%</div>
                  <p className="accounts-bonus-text">
                    {voucher.id === "diamond"
                      ? "Diamond voucher is available from $200 deposit."
                      : "Each voucher can be used once on a real deposit."}
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
              You have {depositBonus?.pending_count} pending real deposit request(s).
            </div>
          )}
        </section>
      )}

      <section className="accounts-kyc-card">
        <div className="accounts-kyc-head">
          <div className="accounts-kyc-chip">
            <ShieldCheck size={14} />
            <span>Identity bonus</span>
          </div>
          <span className={`accounts-kyc-state ${kycApproved ? "ok" : ""}`}>
            {kycApproved ? "Verified" : kycPending ? "In review" : "KYC"}
          </span>
        </div>
        <div className="accounts-kyc-amount">+${kycBonusAmount}</div>
        <p className="accounts-kyc-text">
          One-time bonus after successful identity verification on Real Standard account.
        </p>
        {kycPending && kycStatus?.pending_ticket ? (
          <div className="accounts-kyc-note">Ticket: {kycStatus.pending_ticket}</div>
        ) : null}
        {kycBlockedTemp && kycBlockedLabel ? (
          <div className="accounts-kyc-note">Blocked for: {kycBlockedLabel}</div>
        ) : null}
        {kycBlockedPermanent ? (
          <div className="accounts-kyc-note">Permanently blocked. Contact support/owner.</div>
        ) : null}
        {!isRealStandard ? (
          <div className="accounts-kyc-note">Switch to active Real Standard account.</div>
        ) : null}
        {kycStatus && !kycStatus.is_review_configured ? (
          <div className="accounts-kyc-note">Review chat is not configured yet.</div>
        ) : null}
        <button
          type="button"
          className="accounts-kyc-btn"
          onClick={openKYCModal}
          disabled={
            kycBusy ||
            !isRealStandard ||
            !kycStatus?.can_submit ||
            kycPending ||
            kycApproved ||
            kycBlockedPermanent
          }
        >
          {kycApproved
            ? "Already verified"
            : kycPending
              ? "Pending review"
              : kycBlockedTemp
                ? "Temporarily blocked"
                : kycBlockedPermanent
                  ? "Blocked"
                  : "Verify identity"}
        </button>
      </section>

      {referralStatus && (
        <section className="accounts-referral-card">
          <div className="accounts-referral-head">
            <h3>Referral</h3>
            <span>{referralStatus.referrals_total} invited</span>
          </div>
          <div className="accounts-referral-balance">${referralStatus.balance}</div>
          <div className="accounts-referral-meta">
            <span>Earned ${referralStatus.total_earned}</span>
            <span>Withdrawn ${referralStatus.total_withdrawn}</span>
          </div>
          <div className="accounts-referral-note">
            ${referralStatus.signup_reward_usd} per invite + {referralStatus.deposit_commission_percent}% from real deposits.
          </div>
          <div className="accounts-referral-actions">
            <button type="button" className="accounts-referral-btn" onClick={handleShareReferral}>
              <Share2 size={14} />
              <span>Share</span>
            </button>
            <button
              type="button"
              className="accounts-referral-btn accounts-referral-btn-primary"
              onClick={handleWithdrawReferral}
              disabled={referralBusy || !referralStatus.can_withdraw || referralStatus.real_account_required}
            >
              <span>{referralBusy ? "..." : "Withdraw"}</span>
            </button>
          </div>
        </section>
      )}

      <ActiveAccountCard
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

      <AccountsSwitcherSheet
        open={switcherOpen}
        accounts={accounts}
        activeAccountId={activeAccountId}
        snapshots={switcherSnapshots}
        onClose={() => setSwitcherOpen(false)}
        onSwitch={onSwitch}
      />

      <AccountFundingModal
        open={fundingOpen !== null && !isRealDepositFlow}
        mode={activeAccount.mode as "demo" | "real"}
        type={fundingOpen || "deposit"}
        amount={fundingAmount}
        onAmountChange={setFundingAmount}
        onClose={() => setFundingOpen(null)}
        loading={fundingBusy}
        onSubmit={async () => {
          if (!fundingOpen) return
          if (!fundingAmount || Number(fundingAmount) <= 0) {
            toast.error("Enter valid amount")
            return
          }
          setFundingBusy(true)
          try {
            if (fundingOpen === "deposit") {
              await onTopUpDemo(fundingAmount)
              toast.success("Deposit completed")
            } else {
              await onWithdrawDemo(fundingAmount)
              toast.success("Withdraw completed")
            }
            setFundingOpen(null)
          } catch (err: any) {
            toast.error(err?.message || "Operation failed")
          } finally {
            setFundingBusy(false)
          }
        }}
      />

      <RealDepositRequestModal
        open={isRealDepositFlow}
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
            toast.success("Request submitted. It will be reviewed within 2 hours.")
            setFundingOpen(null)
            setFundingVoucherKind("none")
          } catch (err: any) {
            toast.error(err?.message || "Failed to submit request")
          } finally {
            setFundingBusy(false)
          }
        }}
      />

      <KYCVerificationModal
        open={kycModalOpen}
        status={kycStatus}
        loading={kycBusy}
        onClose={() => {
          if (kycBusy) return
          setKycModalOpen(false)
        }}
        onSubmit={async (payload) => {
          setKycBusy(true)
          try {
            await onRequestKYC(payload)
            toast.success("KYC request submitted")
            setKycModalOpen(false)
          } catch (err: any) {
            toast.error(err?.message || "Failed to submit KYC")
          } finally {
            setKycBusy(false)
          }
        }}
      />

      <AccountDetailsModal
        open={detailsOpen}
        account={activeAccount}
        snapshot={activeSnapshot}
        onClose={() => setDetailsOpen(false)}
        onCloseAll={onCloseAll}
        onRename={onRenameAccount}
        onUpdateLeverage={onUpdateLeverage}
      />

      <AccountCreationModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreate={onCreate}
      />

      {bonusModalOpen && (
        <div className="accounts-bonus-modal" onClick={() => {
          if (bonusBusy) return
          setBonusModalOpen(false)
          setBonusAccepted(false)
        }}>
          <div className="accounts-bonus-backdrop" />
          <div className="accounts-bonus-sheet" onClick={e => e.stopPropagation()}>
            <div className="accounts-bonus-sheet-head">
              <h3>Claim welcome bonus</h3>
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
                You will receive <strong>${signupBonusAmount}</strong> to your Real Standard account once.
              </p>
              <ul className="accounts-bonus-terms">
                <li>Only one claim per user.</li>
                <li>Total global limit: {signupBonus?.total_limit || 700} users.</li>
                <li>Remaining claims: {signupBonus?.remaining ?? 0}.</li>
                <li>Bonus balance is tradable after claim.</li>
              </ul>
              <label className="accounts-bonus-agree">
                <input
                  type="checkbox"
                  checked={bonusAccepted}
                  onChange={e => setBonusAccepted(e.target.checked)}
                  disabled={bonusBusy}
                />
                <span>I agree with the project terms.</span>
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
                    toast.success("Bonus claimed")
                    setBonusModalOpen(false)
                    setBonusAccepted(false)
                  } catch (err: any) {
                    toast.error(err?.message || "Failed to claim bonus")
                  } finally {
                    setBonusBusy(false)
                  }
                }}
              >
                {bonusBusy ? "Claiming..." : `Claim $${signupBonusAmount} bonus`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
