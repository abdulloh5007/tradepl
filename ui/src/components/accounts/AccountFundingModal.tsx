import { ArrowLeft, X } from "lucide-react"
import type { Lang } from "../../types"
import { t } from "../../utils/i18n"
import { useAnimatedPresence } from "../../hooks/useAnimatedPresence"
import TelegramBackButton from "../telegram/TelegramBackButton"
import "./SharedAccountSheet.css"

interface AccountFundingModalProps {
  lang: Lang
  open: boolean
  layout?: "modal" | "page"
  mode: "demo" | "real"
  type: "deposit" | "withdraw"
  amount: string
  onAmountChange: (amount: string) => void
  onClose: () => void
  onSubmit: () => Promise<void>
  loading: boolean
}

export default function AccountFundingModal({
  lang,
  open,
  layout = "modal",
  mode,
  type,
  amount,
  onAmountChange,
  onClose,
  onSubmit,
  loading
}: AccountFundingModalProps) {
  const isPageLayout = layout === "page"
  const { shouldRender, isVisible } = useAnimatedPresence(open, 220)
  if (isPageLayout ? !open : !shouldRender) return null
  const hasTelegramBackButton = isPageLayout &&
    typeof window !== "undefined" &&
    Boolean(window.Telegram?.WebApp?.BackButton?.show) &&
    Boolean(window.Telegram?.WebApp?.BackButton?.onClick)
  const title = type === "deposit" ? t("accounts.deposit", lang) : t("accounts.withdraw", lang)
  const disabled = mode !== "demo"
  const disabledText = type === "deposit" ? t("accounts.realDepositUnavailable", lang) : t("accounts.realWithdrawUnavailable", lang)

  const modalContent = (
      <div className={`acm-sheet ${isPageLayout ? "acm-page-sheet afm-page-sheet" : ""}`}>
        <div className="acm-header">
          {isPageLayout ? (
            <TelegramBackButton onBack={onClose} showFallback={false} />
          ) : null}
          <button
            onClick={onClose}
            className={`acm-close-btn ${hasTelegramBackButton ? "acm-close-btn--ghost" : ""}`}
          >
            {isPageLayout ? <ArrowLeft size={24} /> : <X size={24} />}
          </button>
          <h2 className="acm-title">{title} - {mode === "demo" ? t("accounts.modeDemo", lang) : t("accounts.modeReal", lang)}</h2>
          <div className="acm-spacer" />
        </div>

        <div className="acm-content">
          <div className="acm-form">
            {disabled ? (
              <div className="acm-note" style={{ padding: "40px 20px" }}>{disabledText}</div>
            ) : (
              <>
                <label className="acm-label">
                  {t("accounts.amountUsd", lang)}
                  <input
                    className="acm-input"
                    type="number"
                    min="1"
                    step="0.01"
                    value={amount}
                    onChange={e => onAmountChange(e.target.value)}
                    placeholder={t("accounts.amountPlaceholder", lang)}
                  />
                </label>
                <div className="acm-note" style={{ textAlign: "left" }}>
                  {type === "deposit" ? t("accounts.demoDepositHint", lang) : t("accounts.demoWithdrawHint", lang)}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="acm-footer">
          <button
            type="button"
            className="acm-submit-btn"
            disabled={disabled || loading}
            onClick={() => {
              onSubmit().catch(() => { })
            }}
          >
            {loading ? t("common.processing", lang) : title}
          </button>
        </div>
      </div>
  )

  if (isPageLayout) {
    return (
      <div className="acm-page" role="dialog" aria-modal="true">
        {modalContent}
      </div>
    )
  }

  return (
    <div className={`acm-overlay ${isVisible ? "is-open" : "is-closing"}`} role="dialog" aria-modal="true">
      <div className="acm-backdrop" onClick={onClose} />
      {modalContent}
    </div>
  )
}
