import { useMemo, useState } from "react"
import { toast } from "sonner"
import type { Metrics, TradingAccount } from "../types"
import ActiveAccountCard from "../components/accounts/ActiveAccountCard"
import AccountsSwitcherSheet from "../components/accounts/AccountsSwitcherSheet"
import AccountFundingModal from "../components/accounts/AccountFundingModal"
import AccountDetailsModal from "../components/accounts/AccountDetailsModal"
import type { AccountSnapshot } from "../components/accounts/types"

interface AccountsPageProps {
  accounts: TradingAccount[]
  activeAccountId: string
  metrics: Metrics
  activeOpenOrdersCount: number
  snapshots: Record<string, AccountSnapshot>
  onSwitch: (accountId: string) => Promise<void>
  onCreate: (payload: { plan_id: string; mode: "demo" | "real"; name?: string; is_active?: boolean }) => Promise<void>
  onUpdateLeverage: (accountId: string, leverage: number) => Promise<void>
  onRenameAccount: (accountId: string, name: string) => Promise<void>
  onTopUpDemo: (amount: string) => Promise<void>
  onWithdrawDemo: (amount: string) => Promise<void>
  onCloseAll: () => Promise<void>
  onGoTrade: () => void
}

const planOptions = [
  { id: "standard", label: "Standard" },
  { id: "pro", label: "Pro" },
  { id: "raw", label: "Raw Spread" },
  { id: "swapfree", label: "Swap Free" }
]

type FundingType = "deposit" | "withdraw" | null

export default function AccountsPage({
  accounts,
  activeAccountId,
  metrics,
  activeOpenOrdersCount,
  snapshots,
  onSwitch,
  onCreate,
  onUpdateLeverage,
  onRenameAccount,
  onTopUpDemo,
  onWithdrawDemo,
  onCloseAll,
  onGoTrade
}: AccountsPageProps) {
  const activeAccount = useMemo(() => {
    return accounts.find(a => a.id === activeAccountId) || accounts.find(a => a.is_active) || null
  }, [accounts, activeAccountId])

  const activeSnapshot = useMemo<AccountSnapshot | null>(() => {
    if (!activeAccount) return null
    const fromMap = snapshots[activeAccount.id]
    if (fromMap) return fromMap
    return {
      pl: Number(metrics.pl || 0),
      openCount: activeOpenOrdersCount,
      metrics
    }
  }, [activeAccount, snapshots, metrics, activeOpenOrdersCount])

  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [fundingOpen, setFundingOpen] = useState<FundingType>(null)
  const [fundingAmount, setFundingAmount] = useState("1000")
  const [fundingBusy, setFundingBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createMode, setCreateMode] = useState<"demo" | "real">("demo")
  const [createPlan, setCreatePlan] = useState("standard")
  const [createName, setCreateName] = useState("")

  if (!activeAccount) {
    return (
      <div className="accounts-page">
        <section className="acc-active-card">
          <h2>No accounts</h2>
          <p className="acc-note">Create your first account to start trading.</p>
        </section>
      </div>
    )
  }

  return (
    <div className="accounts-page">
      <ActiveAccountCard
        account={activeAccount}
        snapshot={activeSnapshot || { pl: 0, openCount: 0, metrics: null }}
        switcherOpen={switcherOpen}
        onToggleSwitcher={() => setSwitcherOpen(v => !v)}
        onTrade={onGoTrade}
        onDeposit={() => setFundingOpen("deposit")}
        onWithdraw={() => setFundingOpen("withdraw")}
        onDetails={() => setDetailsOpen(true)}
      />

      <section className="acc-create-card">
        <h3>Open New Account</h3>
        <div className="acc-create-grid">
          <label className="acc-modal-label">
            Mode
            <select value={createMode} onChange={e => setCreateMode(e.target.value as "demo" | "real")}>
              <option value="demo">Demo</option>
              <option value="real">Real</option>
            </select>
          </label>
          <label className="acc-modal-label">
            Account Type
            <select value={createPlan} onChange={e => setCreatePlan(e.target.value)}>
              {planOptions.map(p => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </label>
          <label className="acc-modal-label">
            Name (optional)
            <input
              value={createName}
              onChange={e => setCreateName(e.target.value)}
              placeholder={createMode === "demo" ? "Demo Standard" : "Real Standard"}
            />
          </label>
          <button
            type="button"
            className="acc-action-btn"
            disabled={creating}
            onClick={async () => {
              setCreating(true)
              try {
                await onCreate({
                  plan_id: createPlan,
                  mode: createMode,
                  name: createName.trim() || undefined,
                  is_active: true
                })
                setCreateName("")
              } finally {
                setCreating(false)
              }
            }}
          >
            {creating ? "Creating..." : "Create & Activate"}
          </button>
        </div>
      </section>

      <AccountsSwitcherSheet
        open={switcherOpen}
        accounts={accounts}
        activeAccountId={activeAccountId}
        snapshots={snapshots}
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
    </div>
  )
}
