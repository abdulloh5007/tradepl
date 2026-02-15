import { useEffect, useMemo, useState } from "react"
import { X } from "lucide-react"
import type { Lang, TradingAccount } from "../../types"
import type { AccountSnapshot } from "./types"
import { accountShortNumericId, formatUsd, openCountLabel } from "./utils"
import { t } from "../../utils/i18n"
import "./SharedAccountSheet.css"

interface AccountsSwitcherSheetProps {
  lang: Lang
  open: boolean
  accounts: TradingAccount[]
  activeAccountId: string
  snapshots: Record<string, AccountSnapshot>
  onClose: () => void
  onSwitch: (accountId: string) => Promise<void>
}

export default function AccountsSwitcherSheet({
  lang,
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
    <div className="acm-overlay" role="dialog" aria-modal="true">
      <div className="acm-backdrop" onClick={onClose} />
      <div className="acm-sheet">
        <div className="acm-header">
          <button onClick={onClose} className="acm-close-btn">
            <X size={24} />
          </button>
          <h2 className="acm-title">{t("accounts.switchAccount", lang)}</h2>
          <div className="acm-spacer" />
        </div>

        <div className="acm-content">
          <div className="acm-tabs-container">
            <div className="acm-tabs">
              <button
                type="button"
                className={`acm-tab ${tab === "demo" ? "active" : ""}`}
                onClick={() => setTab("demo")}
              >
                {t("accounts.modeDemo", lang)}
              </button>
              <button
                type="button"
                className={`acm-tab ${tab === "real" ? "active" : ""}`}
                onClick={() => setTab("real")}
              >
                {t("accounts.modeReal", lang)}
              </button>
            </div>
          </div>

          <div className="acm-list">
            {filtered.length === 0 ? (
              <div className="acm-note" style={{ padding: 20 }}>{t("accounts.noModeAccounts", lang).replace("{mode}", tab === "real" ? t("accounts.modeReal", lang) : t("accounts.modeDemo", lang))}</div>
            ) : filtered.map(account => {
              const shot = snapshots[account.id]
              const active = account.id === activeAccountId
              const plColor = !shot ? "#9ca3af" : shot.pl >= 0 ? "#22c55e" : "#ef4444"
              const plPrefix = !shot ? "" : shot.pl >= 0 ? "+" : ""
              return (
                <button
                  type="button"
                  key={account.id}
                  className={`acm-list-item ${active ? "active" : ""}`}
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
                  <div className="acm-label">
                    <strong>{account.name}</strong>
                    <span style={{ fontSize: 12 }}>{account.plan?.name || t("accounts.planStandard", lang)} • #{accountShortNumericId(account.id)}</span>
                  </div>
                  <div className="acm-label" style={{ alignItems: "flex-end" }}>
                    <span style={{ color: plColor, fontWeight: 600 }}>{!shot ? t("common.updating", lang) : `${plPrefix}${formatUsd(shot.pl)} USD`}</span>
                    <span>{!shot ? "—" : openCountLabel(shot.openCount)}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
