import { useEffect, useMemo, useState } from "react"
import type { TradingAccount } from "../../types"
import type { AccountSnapshot } from "./types"
import { accountShortNumericId, formatUsd, openCountLabel } from "./utils"

interface AccountsSwitcherSheetProps {
  open: boolean
  accounts: TradingAccount[]
  activeAccountId: string
  snapshots: Record<string, AccountSnapshot>
  onClose: () => void
  onSwitch: (accountId: string) => Promise<void>
}

export default function AccountsSwitcherSheet({
  open,
  accounts,
  activeAccountId,
  snapshots,
  onClose,
  onSwitch
}: AccountsSwitcherSheetProps) {
  const [tab, setTab] = useState<"real" | "demo">("demo")
  const [switchingId, setSwitchingId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const active = accounts.find(a => a.id === activeAccountId)
    setTab(active?.mode === "real" ? "real" : "demo")
  }, [open, accounts, activeAccountId])

  const filtered = useMemo(() => accounts.filter(a => a.mode === tab), [accounts, tab])
  if (!open) return null

  return (
    <div className="acc-sheet-overlay" role="dialog" aria-modal="true">
      <button type="button" className="acc-sheet-backdrop" onClick={onClose} aria-label="Close accounts switcher" />
      <div className="acc-sheet">
        <div className="acc-sheet-tabs">
          <button type="button" className={tab === "demo" ? "active" : ""} onClick={() => setTab("demo")}>Demo</button>
          <button type="button" className={tab === "real" ? "active" : ""} onClick={() => setTab("real")}>Real</button>
        </div>

        <div className="acc-sheet-list">
          {filtered.length === 0 ? (
            <div className="acc-sheet-empty">No {tab} accounts</div>
          ) : filtered.map(account => {
            const shot = snapshots[account.id] || { pl: 0, openCount: 0, metrics: null }
            const active = account.id === activeAccountId
            const plColor = shot.pl >= 0 ? "#22c55e" : "#ef4444"
            const plPrefix = shot.pl >= 0 ? "+" : ""
            return (
              <button
                type="button"
                key={account.id}
                className={`acc-sheet-item ${active ? "active" : ""}`}
                disabled={active || switchingId === account.id}
                onClick={async () => {
                  setSwitchingId(account.id)
                  try {
                    await onSwitch(account.id)
                    onClose()
                  } finally {
                    setSwitchingId(null)
                  }
                }}
              >
                <div className="acc-sheet-item-head">
                  <strong>{account.name}</strong>
                  <span style={{ color: plColor }}>{plPrefix}{formatUsd(shot.pl)} USD</span>
                </div>
                <div className="acc-sheet-item-sub">
                  <span>{account.mode.toUpperCase()} • #{accountShortNumericId(account.id)}</span>
                  <span>{openCountLabel(shot.openCount)}</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
