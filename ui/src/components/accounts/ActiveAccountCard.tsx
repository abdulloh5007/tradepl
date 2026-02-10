import { ChevronUp, ChevronDown } from "lucide-react"
import type { TradingAccount } from "../../types"
import type { AccountSnapshot } from "./types"
import { accountShortNumericId, formatUsd, openCountLabel } from "./utils"

interface ActiveAccountCardProps {
  account: TradingAccount
  snapshot: AccountSnapshot
  switcherOpen: boolean
  onToggleSwitcher: () => void
  onTrade: () => void
  onDeposit: () => void
  onWithdraw: () => void
  onDetails: () => void
}

export default function ActiveAccountCard({
  account,
  snapshot,
  switcherOpen,
  onToggleSwitcher,
  onTrade,
  onDeposit,
  onWithdraw,
  onDetails
}: ActiveAccountCardProps) {
  const plColor = snapshot.pl >= 0 ? "#22c55e" : "#ef4444"
  const plPrefix = snapshot.pl >= 0 ? "+" : ""

  return (
    <section className="acc-active-card">
      <div className="acc-active-head">
        <div>
          <div className="acc-active-title-row">
            <h2>{account.name}</h2>
            <span className="acc-mini-id">#{accountShortNumericId(account.id)}</span>
          </div>
          <div className="acc-active-sub">
            <span className={`acc-mode-pill ${account.mode}`}>{account.mode.toUpperCase()}</span>
            <span className="acc-plan-pill">{account.plan?.name || account.plan_id}</span>
            <span className="acc-open-pill">{openCountLabel(snapshot.openCount)} open</span>
          </div>
        </div>
        <button type="button" className="acc-switch-toggle" onClick={onToggleSwitcher} aria-label="Open accounts list">
          {switcherOpen ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </button>
      </div>

      <div className="acc-pl-block" style={{ color: plColor }}>
        {plPrefix}{formatUsd(snapshot.pl)} USD
      </div>

      <div className="acc-action-row">
        <button type="button" className="acc-action-btn" onClick={onTrade}>Trade</button>
        <button
          type="button"
          className="acc-action-btn"
          onClick={onDeposit}
          disabled={account.mode !== "demo"}
        >
          {account.mode === "demo" ? "Deposit" : "Deposit Soon"}
        </button>
        <button
          type="button"
          className="acc-action-btn"
          onClick={onWithdraw}
          disabled={account.mode !== "demo"}
        >
          {account.mode === "demo" ? "Withdraw" : "Withdraw Soon"}
        </button>
        <button type="button" className="acc-action-btn" onClick={onDetails}>Details</button>
      </div>
    </section>
  )
}
