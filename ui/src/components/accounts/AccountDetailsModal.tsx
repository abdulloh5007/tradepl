import { useEffect, useMemo, useState } from "react"
import { X } from "lucide-react"
import type { TradingAccount } from "../../types"
import type { AccountSnapshot } from "./types"
import { accountShortNumericId, formatPercent, formatUsd, getLeverage, leverageLabel, leverageOptions } from "./utils"
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

  useEffect(() => {
    if (!account) return
    setNameDraft(account.name || "")
    setLevDraft(getLeverage(account))
  }, [account, open])

  const statRows = useMemo(() => {
    const m = snapshot?.metrics
    return [
      { label: "Balance", value: `${formatUsd(m?.balance || 0)} USD` },
      { label: "Equity", value: `${formatUsd(m?.equity || 0)} USD` },
      { label: "Floating P/L", value: `${snapshot ? `${snapshot.pl >= 0 ? "+" : ""}${formatUsd(snapshot.pl)} USD` : "0.00 USD"}` },
      { label: "Margin", value: `${formatUsd(m?.margin || 0)} USD` },
      { label: "Free Margin", value: `${formatUsd(m?.free_margin || 0)} USD` },
      { label: "Margin Level", value: `${formatPercent(m?.margin_level || 0)}` },
      { label: "Leverage", value: account ? leverageLabel(getLeverage(account)) : "—" }
    ]
  }, [snapshot, account])

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

        <div className="acm-content">
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
                <select
                  className="acm-select"
                  value={String(levDraft)}
                  onChange={e => setLevDraft(Number(e.target.value))}
                >
                  {leverageOptions.map(value => (
                    <option key={value} value={value}>{leverageLabel(value)}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="acm-submit-btn"
                disabled={savingLev || levDraft === getLeverage(account)}
                onClick={async () => {
                  setSavingLev(true)
                  try {
                    await onUpdateLeverage(account.id, levDraft)
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
      </div>
    </div>
  )
}
