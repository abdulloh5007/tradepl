import { ChevronUp, ChevronDown, ArrowDown, ArrowUp, CandlestickChart, MoreHorizontal, ChevronRight } from "lucide-react"
import type { Lang, TradingAccount } from "../../types"
import type { AccountSnapshot } from "./types"
import { accountShortNumericId, formatUsd } from "./utils"
import { t } from "../../utils/i18n"
import "./ActiveAccountCard.css"

interface ActiveAccountCardProps {
  lang: Lang
  account: TradingAccount
  snapshot: AccountSnapshot
  loadingBalance?: boolean
  switcherOpen: boolean
  onToggleSwitcher: () => void
  onTrade: () => void
  onDeposit: () => void
  onWithdraw: () => void
  onDetails: () => void
}

export default function ActiveAccountCard({
  lang,
  account,
  snapshot,
  loadingBalance = false,
  switcherOpen,
  onToggleSwitcher,
  onTrade,
  onDeposit,
  onWithdraw,
  onDetails
}: ActiveAccountCardProps) {
  return (
    <section className="acc-active-card">
      <div className="acc-active-head">
        <div>
          <div className="acc-active-title-row">
            <h2>{account.name.toUpperCase()}</h2>
            <span className="acc-mini-id">#{accountShortNumericId(account.id)}</span>
          </div>
          <div className="acc-active-sub">
            <span className={`acc-mode-pill ${account.mode}`}>{account.mode === "real" ? t("accounts.modeReal", lang) : t("accounts.modeDemo", lang)}</span>
            <span className="acc-platform-pill">MT5</span>
            <span className="acc-plan-pill">{account.plan?.name || t("accounts.planStandard", lang)}</span>
          </div>
        </div>
        <button type="button" className="acc-switch-toggle" onClick={onToggleSwitcher} aria-label={t("accounts.openAccountsList", lang)}>
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="acc-pl-block">
        {loadingBalance ? (
          <span className="acc-balance-skeleton" aria-hidden="true" />
        ) : (
          `${formatUsd(snapshot.metrics?.equity || snapshot.metrics?.balance || 0)} USD`
        )}
      </div>

      <div className="acc-action-row">
        <div className="acc-action-item">
          <button type="button" className="acc-action-btn trade-btn" onClick={onTrade} aria-label={t("accounts.trade", lang)}>
            <CandlestickChart size={24} strokeWidth={2.5} />
          </button>
          <span className="acc-action-label">{t("accounts.trade", lang)}</span>
        </div>

        <div className="acc-action-item">
          <button
            type="button"
            className="acc-action-btn"
            onClick={onDeposit}
            aria-label={t("accounts.deposit", lang)}
          >
            <ArrowDown size={24} strokeWidth={2.5} />
          </button>
          <span className="acc-action-label">{t("accounts.deposit", lang)}</span>
        </div>

        <div className="acc-action-item">
          <button
            type="button"
            className="acc-action-btn"
            onClick={onWithdraw}
            disabled={account.mode !== "demo"}
            aria-label={t("accounts.withdraw", lang)}
          >
            <ArrowUp size={24} strokeWidth={2.5} />
          </button>
          <span className="acc-action-label">{t("accounts.withdraw", lang)}</span>
        </div>

        <div className="acc-action-item">
          <button type="button" className="acc-action-btn" onClick={onDetails} aria-label={t("accounts.details", lang)}>
            <MoreHorizontal size={24} strokeWidth={2.5} />
          </button>
          <span className="acc-action-label">{t("accounts.details", lang)}</span>
        </div>
      </div>
    </section>
  )
}
