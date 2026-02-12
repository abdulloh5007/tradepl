import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Gift, Plus, X } from "lucide-react"
import type { SignupBonusStatus } from "../../api"
import type { Metrics, TradingAccount } from "../../types"
import ActiveAccountCard from "../../components/accounts/ActiveAccountCard"
import AccountsSwitcherSheet from "../../components/accounts/AccountsSwitcherSheet"
import AccountFundingModal from "../../components/accounts/AccountFundingModal"
import AccountDetailsModal from "../../components/accounts/AccountDetailsModal"
import AccountCreationModal from "../../components/accounts/AccountCreationModal"
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
  onClaimSignupBonus: () => Promise<void>
  onCloseAll: () => Promise<void>
  onGoTrade: () => void
}

type FundingType = "deposit" | "withdraw" | null

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
  onClaimSignupBonus,
  onCloseAll,
  onGoTrade
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
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [bonusModalOpen, setBonusModalOpen] = useState(false)
  const [bonusAccepted, setBonusAccepted] = useState(false)
  const [bonusBusy, setBonusBusy] = useState(false)

  const showSignupBonus = !!signupBonus && !signupBonus.claimed && signupBonus.can_claim
  const signupBonusAmount = signupBonus?.amount || "10.00"

  const switcherSnapshots = useMemo(() => {
    if (!activeAccount || !activeSnapshot) return snapshots
    return {
      ...snapshots,
      [activeAccount.id]: activeSnapshot
    }
  }, [snapshots, activeAccount, activeSnapshot])

  if (!activeAccount) {
    return (
      <div className="accounts-page">
        <div className="accounts-header">
          <h1 className="accounts-title">Accounts</h1>
          <button
            onClick={() => setCreateModalOpen(true)}
            className="add-account-btn"
          >
            <Plus size={24} />
          </button>
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

  return (
    <div className="accounts-page pb-24">
      <div className="accounts-header">
        <h1 className="accounts-title">Accounts</h1>
        <button
          onClick={() => setCreateModalOpen(true)}
          className="add-account-btn"
        >
          <Plus size={20} />
        </button>
      </div>

      {showSignupBonus && (
        <section className="accounts-bonus-card">
          <div className="accounts-bonus-head">
            <div className="accounts-bonus-chip">
              <Gift size={14} />
              <span>Welcome bonus</span>
            </div>
          </div>
          <div className="accounts-bonus-body">
            <div className="accounts-bonus-amount">+${signupBonusAmount}</div>
            <p className="accounts-bonus-text">
              One-time reward to your real account.
            </p>
            <button
              type="button"
              className="accounts-bonus-claim-btn"
              onClick={() => setBonusModalOpen(true)}
            >
              Claim bonus
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
        onDeposit={() => setFundingOpen("deposit")}
        onWithdraw={() => setFundingOpen("withdraw")}
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
        open={fundingOpen !== null}
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
                You will receive <strong>${signupBonusAmount}</strong> to your real account once.
              </p>
              <ul className="accounts-bonus-terms">
                <li>Bonus is available only once per user.</li>
                <li>Bonus funds are tradable after claim.</li>
                <li>The bonus cannot be claimed again after activation.</li>
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
                {bonusBusy ? "Claiming..." : "Claim $10 bonus"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
