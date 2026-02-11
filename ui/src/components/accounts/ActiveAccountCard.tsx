import { ChevronUp, ChevronDown, ArrowDown, ArrowUp, CandlestickChart, MoreHorizontal, ChevronRight } from "lucide-react"
import type { TradingAccount } from "../../types"
import type { AccountSnapshot } from "./types"
import { accountShortNumericId, formatUsd } from "./utils"
import "./ActiveAccountCard.css"

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
  // Always white for balance in this design
  const plColor = "#ffffff"

  return (
    <section className="acc-active-card">
      <div className="acc-active-head">
        <div>
          <div className="acc-active-title-row">
            <h2>{account.name.toUpperCase()}</h2>
            <span className="acc-mini-id">#{accountShortNumericId(account.id)}</span>
          </div>
          <div className="acc-active-sub">
            <span className={`acc-mode-pill ${account.mode}`}>{account.mode === 'real' ? 'Real' : 'Demo'}</span>
            <span className="acc-platform-pill">MT5</span>
            <span className="acc-plan-pill">{account.plan?.name || "Standard"}</span>
          </div>
        </div>
        <button type="button" className="acc-switch-toggle" onClick={onToggleSwitcher} aria-label="Open accounts list">
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="acc-pl-block" style={{ color: plColor }}>
        {formatUsd(snapshot.metrics?.equity || snapshot.metrics?.balance || 0)} USD
      </div>

      <div className="acc-action-row">
        <div className="acc-action-item">
          <button type="button" className="acc-action-btn trade-btn" onClick={onTrade} aria-label="Trade">
            <CandlestickChart size={24} strokeWidth={2.5} />
          </button>
          <span className="acc-action-label">Trade</span>
        </div>

        <div className="acc-action-item">
          <button
            type="button"
            className="acc-action-btn"
            onClick={onDeposit}
            disabled={account.mode !== "demo"}
            aria-label="Deposit"
          >
            <ArrowDown size={24} strokeWidth={2.5} />
          </button>
          <span className="acc-action-label">Deposit</span>
        </div>

        <div className="acc-action-item">
          <button
            type="button"
            className="acc-action-btn"
            onClick={onWithdraw}
            disabled={account.mode !== "demo"}
            aria-label="Withdraw"
          >
            <ArrowUp size={24} strokeWidth={2.5} />
          </button>
          <span className="acc-action-label">Withdraw</span>
        </div>

        <div className="acc-action-item">
          <button type="button" className="acc-action-btn" onClick={onDetails} aria-label="Account Details">
            <MoreHorizontal size={24} strokeWidth={2.5} />
          </button>
          <span className="acc-action-label">Details</span>
        </div>
      </div>
    </section>
  )
}
