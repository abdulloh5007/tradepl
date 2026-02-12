import { useEffect, useMemo, useState } from "react"
import { X } from "lucide-react"
import { toast } from "sonner"
import type { TradingAccount } from "../../types"
import type { AccountSnapshot } from "./types"
import { accountShortNumericId, formatPercent, formatUsd, getLeverage, leverageLabel, leverageOptions } from "./utils"
import SmartDropdown from "../ui/SmartDropdown"
import "./SharedAccountSheet.css"

interface AccountDetailsModalProps {
  open: boolean
  account: TradingAccount | null
  snapshot: AccountSnapshot | null
  onClose: () => void
  onCloseAll: () => Promise<void>
  onRename: (accountId: string, name: string) => Promise<void>
  onUpdateLeverage: (accountId: string, leverage: number) => Promise<void>
}

export default function AccountDetailsModal({
  open,
  account,
  snapshot,
  onClose,
  onCloseAll,
  onRename,
  onUpdateLeverage
}: AccountDetailsModalProps) {
  const [tab, setTab] = useState<"stats" | "settings">("stats")
  const [nameDraft, setNameDraft] = useState("")
  const [levDraft, setLevDraft] = useState(100)
  const [savingName, setSavingName] = useState(false)
  const [savingLev, setSavingLev] = useState(false)
  const [closingAll, setClosingAll] = useState(false)
  const [unlimitedConfirmOpen, setUnlimitedConfirmOpen] = useState(false)

  useEffect(() => {
    if (!account) return
    setNameDraft(account.name || "")
    setLevDraft(getLeverage(account))
    setUnlimitedConfirmOpen(false)
  }, [account, open])

  const statRows = useMemo(() => {
    const m = snapshot?.metrics
    const rows = [
      { label: "Balance", value: `${formatUsd(m?.balance || 0)} USD` },
      { label: "Equity", value: `${formatUsd(m?.equity || 0)} USD` },
      { label: "Floating P/L", value: `${snapshot ? `${snapshot.pl >= 0 ? "+" : ""}${formatUsd(snapshot.pl)} USD` : "0.00 USD"}` },
      { label: "Leverage", value: account ? leverageLabel(getLeverage(account)) : "—" }
    ]
    const isUnlimited = account ? getLeverage(account) === 0 : false
    if (!isUnlimited) {
      rows.splice(3, 0,
        { label: "Margin", value: `${formatUsd(m?.margin || 0)} USD` },
        { label: "Free Margin", value: `${formatUsd(m?.free_margin || 0)} USD` },
        { label: "Margin Level", value: `${formatPercent(m?.margin_level || 0)}` },
      )
    }
    return rows
  }, [snapshot, account])

  const leverageItems = useMemo(() => {
    return leverageOptions.map(value => ({ value, label: leverageLabel(value) }))
  }, [])
  const hasOpenOrders = (snapshot?.openCount || 0) > 0
  const rawBalance = Number(snapshot?.metrics?.balance ?? account?.balance ?? 0)
  const accountBalance = Number.isFinite(rawBalance) ? rawBalance : 0
  const unlimitedBlockedByBalance = levDraft === 0 && account && getLeverage(account) !== 0 && accountBalance > 1000

  if (!open || !account) return null

  return (
    <div className="acm-overlay" role="dialog" aria-modal="true">
      <div className="acm-backdrop" onClick={onClose} />
      <div className="acm-sheet">
        <div className="acm-header">
          <button onClick={onClose} className="acm-close-btn">
            <X size={24} />
          </button>
          <div style={{ textAlign: "center" }}>
            <h2 className="acm-title">Account Details</h2>
            <div className="acm-note" style={{ fontSize: 10 }}>#{accountShortNumericId(account.id)}</div>
          </div>
          <div className="acm-spacer" />
        </div>

        <div className="acm-content acm-details-content">
          <div className="acm-tabs-container">
            <div className="acm-tabs">
              <button className={`acm-tab ${tab === "stats" ? "active" : ""}`} onClick={() => setTab("stats")}>Stats</button>
              <button className={`acm-tab ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")}>Settings</button>
            </div>
          </div>

          {tab === "stats" ? (
            <div className="acm-list">
              {statRows.map(row => (
                <div key={row.label} className="acm-list-item" style={{ cursor: "default" }}>
                  <span className="acm-label" style={{ marginBottom: 0 }}>{row.label}</span>
                  <strong>{row.value}</strong>
                </div>
              ))}

              {hasOpenOrders && (
                <button
                  type="button"
                  className="acm-danger-btn"
                  disabled={closingAll}
                  onClick={async () => {
                    const ok = window.confirm("Close all open orders for this account?")
                    if (!ok) return
                    setClosingAll(true)
                    try {
                      await onCloseAll()
                    } finally {
                      setClosingAll(false)
                    }
                  }}
                >
                  <X size={14} /> {closingAll ? "Closing..." : "Close All Orders"}
                </button>
              )}
            </div>
          ) : (
            <div className="acm-form">
              <label className="acm-label">
                Account Name
                <input
                  className="acm-input"
                  value={nameDraft}
                  onChange={e => setNameDraft(e.target.value)}
                  maxLength={64}
                />
              </label>
              <button
                type="button"
                className="acm-submit-btn"
                disabled={savingName || nameDraft.trim().length === 0 || nameDraft.trim() === account.name}
                onClick={async () => {
                  setSavingName(true)
                  try {
                    await onRename(account.id, nameDraft.trim())
                  } finally {
                    setSavingName(false)
                  }
                }}
              >
                {savingName ? "Saving..." : "Save Name"}
              </button>

              <div className="acm-list-item" style={{ cursor: "default", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
                <span className="acm-label">Commission</span>
                <strong>{((account.plan?.commission_rate || 0) * 100).toFixed(2)}%</strong>
              </div>
              <div className="acm-list-item" style={{ cursor: "default", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
                <span className="acm-label">Min Spread</span>
                <strong>x{(account.plan?.spread_multiplier || 1).toFixed(2)}</strong>
              </div>

              <label className="acm-label">
                Leverage
                <SmartDropdown
                  value={String(levDraft)}
                  options={leverageItems}
                  onChange={(next) => setLevDraft(Number(next))}
                  ariaLabel="Select leverage"
                  className="acm-dropdown"
                  triggerClassName="acm-select-like"
                  menuClassName="acm-dropdown-menu"
                />
              </label>
              {unlimitedBlockedByBalance && (
                <div className="acm-note" style={{ textAlign: "left", color: "#f59e0b" }}>
                  Unlimited is unavailable when balance is above 1000 USD.
                </div>
              )}
              <button
                type="button"
                className="acm-submit-btn"
                disabled={savingLev || levDraft === getLeverage(account) || unlimitedBlockedByBalance}
                onClick={async () => {
                  if (unlimitedBlockedByBalance) {
                    toast.error("Unlimited is unavailable when balance is above 1000 USD")
                    return
                  }
                  if (levDraft === 0 && getLeverage(account) !== 0) {
                    setUnlimitedConfirmOpen(true)
                    return
                  }
                  setSavingLev(true)
                  try {
                    await onUpdateLeverage(account.id, levDraft)
                  } catch (err: any) {
                    toast.error(err?.message || "Failed to update leverage")
                  } finally {
                    setSavingLev(false)
                  }
                }}
              >
                {savingLev ? "Saving..." : "Apply Leverage"}
              </button>
            </div>
          )}
        </div>

        {unlimitedConfirmOpen && (
          <div className="acm-confirm-overlay" role="dialog" aria-modal="true">
            <div className="acm-confirm-backdrop" onClick={() => setUnlimitedConfirmOpen(false)} />
            <div className="acm-confirm-card">
              <h3 className="acm-confirm-title">Enable Unlimited Leverage?</h3>
              <p className="acm-confirm-text">
                Read and confirm system rules:
              </p>
              <p className="acm-confirm-rule">
                1. If balance becomes greater than 1000 USD, leverage will be auto-changed to 1:2000.
              </p>
              <p className="acm-confirm-rule">
                2. If equity drops below 0, system will auto-close all orders and reset account balance to 0.
              </p>
              <div className="acm-confirm-actions">
                <button
                  type="button"
                  className="acm-submit-btn ghost"
                  onClick={() => setUnlimitedConfirmOpen(false)}
                  disabled={savingLev}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="acm-submit-btn"
                  disabled={savingLev || accountBalance > 1000}
                  onClick={async () => {
                    if (accountBalance > 1000) {
                      toast.error("Unlimited is unavailable when balance is above 1000 USD")
                      setUnlimitedConfirmOpen(false)
                      return
                    }
                    setSavingLev(true)
                    try {
                      await onUpdateLeverage(account.id, 0)
                      setUnlimitedConfirmOpen(false)
                    } catch (err: any) {
                      toast.error(err?.message || "Failed to update leverage")
                    } finally {
                      setSavingLev(false)
                    }
                  }}
                >
                  {savingLev ? "Saving..." : "Enable Unlimited"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
