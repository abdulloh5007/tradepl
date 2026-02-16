import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, X } from "lucide-react"
import { toast } from "sonner"
import type { DepositBonusStatus, DepositPaymentMethod } from "../../api"
import type { Lang } from "../../types"
import { t } from "../../utils/i18n"
import { useAnimatedPresence } from "../../hooks/useAnimatedPresence"
import PaymentMethodIcon from "./PaymentMethodIcon"
import {
  formatMethodInputForEditing,
  methodFormatExample,
  validateAndNormalizeMethodInput,
} from "../../utils/paymentMethodFormats"
import "./RealWithdrawRequestModal.css"

interface RealWithdrawRequestModalProps {
  lang: Lang
  open: boolean
  layout?: "modal" | "page"
  status: DepositBonusStatus | null
  loading: boolean
  onClose: () => void
  onSubmit: (payload: {
    amountUSD: string
    methodID: string
    payoutDetails: string
  }) => Promise<void>
}

const formatIntWithSpaces = (value: string) => value.replace(/\B(?=(\d{3})+(?!\d))/g, " ")

const normalizeAmountInput = (value: string): { raw: string; display: string } => {
  const stripped = value.replace(/\s+/g, "").replace(/,/g, ".").replace(/[^\d.]/g, "")
  if (!stripped) return { raw: "", display: "" }

  const dot = stripped.indexOf(".")
  let intPart = dot >= 0 ? stripped.slice(0, dot) : stripped
  let fracPart = dot >= 0 ? stripped.slice(dot + 1).replace(/\./g, "") : ""
  intPart = intPart.replace(/^0+(?=\d)/, "")
  if (intPart === "") intPart = "0"
  fracPart = fracPart.slice(0, 2)
  const raw = fracPart ? `${intPart}.${fracPart}` : intPart
  const display = fracPart ? `${formatIntWithSpaces(intPart)}.${fracPart}` : formatIntWithSpaces(intPart)
  return { raw, display }
}

const amountToApi = (raw: string) => {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return ""
  return n.toFixed(2)
}

export default function RealWithdrawRequestModal({
  lang,
  open,
  layout = "modal",
  status,
  loading,
  onClose,
  onSubmit,
}: RealWithdrawRequestModalProps) {
  const isPageLayout = layout === "page"
  const { shouldRender, isVisible } = useAnimatedPresence(open, 220)
  const [amountRaw, setAmountRaw] = useState("")
  const [amountDisplay, setAmountDisplay] = useState("")
  const [methodID, setMethodID] = useState("")
  const [payoutDetails, setPayoutDetails] = useState("")

  const paymentMethods = useMemo<DepositPaymentMethod[]>(() => {
    const list = Array.isArray(status?.payment_methods) ? status.payment_methods : []
    return list.map((item) => ({
      id: String(item?.id || "").trim().toLowerCase(),
      title: String(item?.title || item?.id || "").trim(),
      details: String(item?.details || "").trim(),
      enabled: Boolean(item?.enabled && String(item?.details || "").trim()),
    })).filter((item) => item.id !== "")
  }, [status?.payment_methods])

  const availableMethodIDs = useMemo(() => {
    return paymentMethods.filter((item) => item.enabled).map((item) => item.id)
  }, [paymentMethods])

  const selectedMethod = paymentMethods.find((item) => item.id === methodID) || null

  useEffect(() => {
    if (!open) return
    setAmountRaw("")
    setAmountDisplay("")
    setPayoutDetails("")
    setMethodID(availableMethodIDs[0] || "")
  }, [open, availableMethodIDs])

  useEffect(() => {
    if (methodID && availableMethodIDs.includes(methodID)) return
    setMethodID(availableMethodIDs[0] || "")
  }, [methodID, availableMethodIDs])

  if (isPageLayout ? !open : !shouldRender) return null

  const amountNum = Number(amountRaw)
  const amountValid = Number.isFinite(amountNum) && amountNum > 0
  const payoutCheck = validateAndNormalizeMethodInput(methodID, payoutDetails)
  const canSubmit = amountValid && selectedMethod?.enabled && payoutCheck.valid && !loading

  const modalContent = (
      <div className={`acm-sheet ${isPageLayout ? "acm-page-sheet" : ""}`}>
        <div className="acm-header">
          <button onClick={() => {
            if (!loading) onClose()
          }} className="acm-close-btn">
            {isPageLayout ? <ArrowLeft size={24} /> : <X size={24} />}
          </button>
          <h2 className="acm-title">{t("accounts.realWithdrawTitle", lang)}</h2>
          <div className="acm-spacer" />
        </div>

        <div className="acm-content">
          <div className="acm-form rwm-form">
            <label className="acm-label">
              {t("accounts.amountUsd", lang)}
              <input
                className="acm-input"
                inputMode="decimal"
                value={amountDisplay}
                onChange={(e) => {
                  const next = normalizeAmountInput(e.target.value)
                  setAmountRaw(next.raw)
                  setAmountDisplay(next.display)
                }}
                placeholder={t("accounts.amountPlaceholder", lang)}
              />
            </label>

            <div className="rdm-methods-block">
              <div className="rdm-methods-title">{t("accounts.withdrawMethodChoose", lang)}</div>
              <div className="rdm-methods-grid">
                {paymentMethods.map((method) => {
                  const disabled = !method.enabled
                  const active = methodID === method.id
                  const titleKey = `accounts.paymentMethod.${method.id}`
                  const title = t(titleKey, lang) === titleKey ? method.title : t(titleKey, lang)
                  return (
                    <button
                      key={method.id}
                      type="button"
                      className={`rdm-method-btn ${active ? "active" : ""} ${disabled ? "disabled" : ""}`}
                      disabled={disabled}
                      onClick={() => {
                        if (!disabled) setMethodID(method.id)
                      }}
                    >
                      <span className="rdm-method-icon">
                        <PaymentMethodIcon methodID={method.id} size={15} className="rdm-method-icon-media" />
                      </span>
                      <span className="rdm-method-name">{title}</span>
                    </button>
                  )
                })}
              </div>
              {!selectedMethod?.enabled ? (
                <div className="acm-note rwm-note-warning">
                  {paymentMethods.length === 0 ? t("accounts.noPaymentMethods", lang) : t("accounts.paymentMethodRequired", lang)}
                </div>
              ) : null}
            </div>

            <label className="acm-label">
              {t("accounts.withdrawDetailsLabel", lang)}
              <input
                className={`acm-input ${payoutDetails && !payoutCheck.valid ? "rwm-input-error" : ""}`}
                inputMode={methodID === "paypal" ? "email" : "text"}
                value={payoutDetails}
                placeholder={methodFormatExample(methodID)}
                onChange={(e) => setPayoutDetails(formatMethodInputForEditing(methodID, e.target.value))}
              />
            </label>
            <div className="rwm-format-hint">
              {t("accounts.withdrawFormatHint", lang).replace("{format}", methodFormatExample(methodID))}
            </div>
            {payoutDetails && !payoutCheck.valid ? (
              <div className="rwm-format-error">
                {t("accounts.withdrawFormatInvalid", lang)}
              </div>
            ) : null}

            <div className="acm-note rwm-note">
              {t("accounts.realWithdrawInstantHint", lang)}
            </div>
          </div>
        </div>

        <div className="acm-footer">
          <button
            type="button"
            className="acm-submit-btn"
            disabled={!canSubmit}
            onClick={async () => {
              if (!amountValid) {
                toast.error(t("accounts.errors.enterValidAmount", lang))
                return
              }
              if (!selectedMethod?.enabled) {
                toast.error(t("accounts.paymentMethodRequired", lang))
                return
              }
              if (!payoutCheck.valid) {
                toast.error(t("accounts.withdrawFormatInvalid", lang))
                return
              }
              await onSubmit({
                amountUSD: amountToApi(amountRaw),
                methodID: selectedMethod.id,
                payoutDetails: payoutCheck.normalized,
              })
            }}
          >
            {loading ? t("common.processing", lang) : t("accounts.withdraw", lang)}
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
      <div className="acm-backdrop" onClick={() => {
        if (!loading) onClose()
      }} />
      {modalContent}
    </div>
  )
}
