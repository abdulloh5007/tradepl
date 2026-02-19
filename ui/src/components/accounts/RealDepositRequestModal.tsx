import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, CheckCircle2, Copy, Gift, Upload, X } from "lucide-react"
import { toast } from "sonner"
import type { DepositBonusStatus, DepositPaymentMethod } from "../../api"
import type { Lang } from "../../types"
import { formatNumber } from "../../utils/format"
import { t } from "../../utils/i18n"
import { useAnimatedPresence } from "../../hooks/useAnimatedPresence"
import TelegramBackButton from "../telegram/TelegramBackButton"
import PaymentMethodIcon from "./PaymentMethodIcon"
import "./RealDepositRequestModal.css"

type VoucherKind = "none" | "gold" | "diamond"

interface RealDepositRequestModalProps {
  lang: Lang
  open: boolean
  layout?: "modal" | "page"
  status: DepositBonusStatus | null
  allowVouchers: boolean
  defaultVoucher?: VoucherKind
  loading: boolean
  onClose: () => void
  onSubmit: (payload: {
    amountUSD: string
    voucherKind: VoucherKind
    methodID: string
    proofFile: File
  }) => Promise<void>
}

const MAX_PROOF_SIZE = 5 * 1024 * 1024
const DIAMOND_MIN_AMOUNT = 200
const UZS_METHOD_IDS = new Set(["visa_sum", "uzcard", "humo"])

const normalizeVoucherKind = (value?: string): VoucherKind => {
  const v = String(value || "").trim().toLowerCase()
  if (v === "gold" || v === "diamond") return v
  return "none"
}

const formatIntWithSpaces = (value: string) => value.replace(/\B(?=(\d{3})+(?!\d))/g, " ")

const normalizeAmountInput = (value: string, allowFraction: boolean): { raw: string; display: string } => {
  const stripped = value.replace(/\s+/g, "").replace(/,/g, ".").replace(/[^\d.]/g, "")
  if (!stripped) return { raw: "", display: "" }

  const dot = stripped.indexOf(".")
  let intPart = dot >= 0 ? stripped.slice(0, dot) : stripped
  let fracPart = allowFraction && dot >= 0 ? stripped.slice(dot + 1).replace(/\./g, "") : ""

  intPart = intPart.replace(/^0+(?=\d)/, "")
  if (intPart === "") intPart = "0"
  fracPart = allowFraction ? fracPart.slice(0, 2) : ""

  const raw = fracPart ? `${intPart}.${fracPart}` : intPart
  const display = fracPart ? `${formatIntWithSpaces(intPart)}.${fracPart}` : formatIntWithSpaces(intPart)
  return { raw, display }
}

const amountToApi = (value: number) => {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return ""
  return n.toFixed(2)
}

const isUzsMethod = (methodID: string) => UZS_METHOD_IDS.has(String(methodID || "").trim().toLowerCase())

const copyToClipboard = async (text: string) => {
  const value = String(text || "")
  if (!value) return false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // Fall back below.
  }
  try {
    const area = document.createElement("textarea")
    area.value = value
    area.style.position = "fixed"
    area.style.opacity = "0"
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

export default function RealDepositRequestModal({
  lang,
  open,
  layout = "modal",
  status,
  allowVouchers,
  defaultVoucher = "none",
  loading,
  onClose,
  onSubmit,
}: RealDepositRequestModalProps) {
  const isPageLayout = layout === "page"
  const { shouldRender, isVisible } = useAnimatedPresence(open, 220)
  const hasTelegramBackButton = isPageLayout &&
    typeof window !== "undefined" &&
    Boolean(window.Telegram?.WebApp?.BackButton?.show) &&
    Boolean(window.Telegram?.WebApp?.BackButton?.onClick)
  const [amountRaw, setAmountRaw] = useState("")
  const [amountDisplay, setAmountDisplay] = useState("")
  const [voucherKind, setVoucherKind] = useState<VoucherKind>("none")
  const [methodID, setMethodID] = useState("")
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const uzsRate = Number(status?.usd_to_uzs_rate || "0")
  const reviewMinutes = Number(status?.review_minutes || 120)

  const vouchers = useMemo(() => {
    const hasPending = Number(status?.pending_count || 0) > 0
    if (!status?.vouchers) return []
    return status.vouchers
      .map(v => ({
        id: normalizeVoucherKind(v.id),
        percent: Number(v.percent || "0"),
        title: v.title || String(v.id || ""),
        minAmount: normalizeVoucherKind(v.id) === "diamond" ? DIAMOND_MIN_AMOUNT : 0,
        available: Boolean(allowVouchers && v.available && !v.used && !hasPending),
      }))
      .filter(v => v.id === "gold" || v.id === "diamond")
  }, [status?.vouchers, status?.pending_count, allowVouchers])

  const paymentMethods = useMemo<DepositPaymentMethod[]>(() => {
    const list = Array.isArray(status?.payment_methods) ? status?.payment_methods : []
    return list.map((item) => ({
      id: String(item?.id || "").trim().toLowerCase(),
      title: String(item?.title || item?.id || "").trim(),
      details: String(item?.details || "").trim(),
      enabled: Boolean(item?.enabled && String(item?.details || "").trim()),
      min_amount_usd: String(item?.min_amount_usd || status?.min_amount_usd || "0").trim(),
      max_amount_usd: String(item?.max_amount_usd || status?.max_amount_usd || "0").trim(),
    })).filter((item) => item.id !== "")
  }, [status?.payment_methods, status?.min_amount_usd, status?.max_amount_usd])

  const availableMethodIDs = useMemo(() => {
    return paymentMethods.filter((item) => item.enabled).map((item) => item.id)
  }, [paymentMethods])

  const availableVoucherIds = useMemo(() => {
    return vouchers.filter(v => v.available).map(v => v.id)
  }, [vouchers])

  const selectedMethod = paymentMethods.find((item) => item.id === methodID) || null
  const selectedMethodMinUSD = Number(selectedMethod?.min_amount_usd || status?.min_amount_usd || "0")
  const selectedMethodMaxUSDRaw = Number(selectedMethod?.max_amount_usd || status?.max_amount_usd || "0")
  const selectedMethodMaxUSD = selectedMethodMaxUSDRaw >= selectedMethodMinUSD ? selectedMethodMaxUSDRaw : selectedMethodMinUSD
  const uzsMethodSelected = selectedMethod ? isUzsMethod(selectedMethod.id) : false
  const amountNum = Number(amountRaw)
  const amountValid = Number.isFinite(amountNum) && amountNum > 0
  const hasRate = Number.isFinite(uzsRate) && uzsRate > 0
  const amountUSDForValidation = uzsMethodSelected
    ? (hasRate && amountValid ? amountNum / uzsRate : Number.NaN)
    : amountNum
  const amountTooHigh = Number.isFinite(amountUSDForValidation) && selectedMethodMaxUSD > 0 && amountUSDForValidation > selectedMethodMaxUSD
  const withinLimits = Number.isFinite(amountUSDForValidation) &&
    amountUSDForValidation >= selectedMethodMinUSD &&
    amountUSDForValidation <= selectedMethodMaxUSD &&
    (!uzsMethodSelected || hasRate)
  const minLimitDisplay = uzsMethodSelected ? selectedMethodMinUSD * uzsRate : selectedMethodMinUSD
  const maxLimitDisplay = uzsMethodSelected ? selectedMethodMaxUSD * uzsRate : selectedMethodMaxUSD
  const inputCurrencyCode = uzsMethodSelected ? "UZS" : "USD"
  const inputFractionAllowed = !uzsMethodSelected

  const activeVoucherPercent = useMemo(() => {
    if (voucherKind === "none") return 0
    const item = vouchers.find(v => v.id === voucherKind)
    if (!item || !item.available) return 0
    return item.percent
  }, [vouchers, voucherKind])

  const bonusAmount = Number.isFinite(amountUSDForValidation) ? (amountUSDForValidation * activeVoucherPercent) / 100 : 0
  const totalAmount = Number.isFinite(amountUSDForValidation) ? amountUSDForValidation + bonusAmount : 0

  const resetState = () => {
    const preferred = normalizeVoucherKind(defaultVoucher)
    const initialMethod = availableMethodIDs[0] || ""
    const initialIsUzs = isUzsMethod(initialMethod)
    const initialMethodConfig = paymentMethods.find((item) => item.id === initialMethod) || null
    const initialMethodMinUSD = Number(initialMethodConfig?.min_amount_usd || status?.min_amount_usd || "0")
    const baseDefaultAmountUSD = initialMethodMinUSD > 0 ? initialMethodMinUSD : 0
    const forcedAmountUSD = preferred === "diamond" ? Math.max(baseDefaultAmountUSD, DIAMOND_MIN_AMOUNT) : baseDefaultAmountUSD
    const forcedAmountInput = initialIsUzs ? forcedAmountUSD * uzsRate : forcedAmountUSD
    const initialAmount = forcedAmountInput > 0 ? String(forcedAmountInput) : ""
    setAmountRaw(initialAmount)
    setAmountDisplay(initialAmount ? normalizeAmountInput(initialAmount, !initialIsUzs).display : "")
    setProofFile(null)
    setDragOver(false)
    setMethodID(initialMethod)

    if (preferred !== "none" && availableVoucherIds.includes(preferred)) {
      setVoucherKind(preferred)
      return
    }
    if (availableVoucherIds.length > 0) {
      setVoucherKind(availableVoucherIds[0])
    } else {
      setVoucherKind("none")
    }
  }

  useEffect(() => {
    if (!open) return
    resetState()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultVoucher, paymentMethods, availableMethodIDs, status?.eligible_account_id, status?.pending_count, status?.vouchers, status?.payment_methods, status?.min_amount_usd, uzsRate])

  useEffect(() => {
    if (
      voucherKind === "diamond" &&
      Number.isFinite(amountUSDForValidation) &&
      amountUSDForValidation < DIAMOND_MIN_AMOUNT
    ) {
      setVoucherKind("none")
    }
  }, [voucherKind, amountUSDForValidation])

  useEffect(() => {
    if (voucherKind === "none") return
    if (!availableVoucherIds.includes(voucherKind)) {
      if (availableVoucherIds.length > 0) setVoucherKind(availableVoucherIds[0])
      else setVoucherKind("none")
    }
  }, [voucherKind, availableVoucherIds])

  useEffect(() => {
    if (methodID && availableMethodIDs.includes(methodID)) return
    setMethodID(availableMethodIDs[0] || "")
  }, [methodID, availableMethodIDs])

  if (isPageLayout ? !open : !shouldRender) return null

  const pickProof = (file?: File | null) => {
    if (!file) return
    if (file.size > MAX_PROOF_SIZE) {
      toast.error(t("accounts.depositProofTooLarge", lang))
      return
    }
    setProofFile(file)
  }

  const disabledSubmit = loading || !withinLimits || !proofFile || !selectedMethod || !selectedMethod.enabled

  const modalContent = (
      <div className={`acm-sheet ${isPageLayout ? "acm-page-sheet rdm-page-sheet" : ""}`}>
        <div className="acm-header">
          {isPageLayout ? (
            <TelegramBackButton onBack={onClose} showFallback={false} />
          ) : null}
          <button
            onClick={() => {
              if (!loading) onClose()
            }}
            className={`acm-close-btn ${hasTelegramBackButton ? "acm-close-btn--ghost" : ""}`}
          >
            {isPageLayout ? <ArrowLeft size={24} /> : <X size={24} />}
          </button>
          <h2 className="acm-title">{t("accounts.realDeposit", lang)}</h2>
          <div className="acm-spacer" />
        </div>

        <div className="acm-content">
          <div className="acm-form rdm-form">
            <label className="acm-label">
              {uzsMethodSelected ? t("accounts.amountUzs", lang) : t("accounts.amountUsd", lang)}
              <input
                className={`acm-input ${amountTooHigh ? "rdm-input-error" : ""}`}
                inputMode={uzsMethodSelected ? "numeric" : "decimal"}
                value={amountDisplay}
                onChange={e => {
                  const next = normalizeAmountInput(e.target.value, inputFractionAllowed)
                  setAmountRaw(next.raw)
                  setAmountDisplay(next.display)
                }}
                placeholder={uzsMethodSelected ? t("accounts.amountPlaceholderUzs", lang) : t("accounts.amountPlaceholder", lang)}
              />
            </label>
            {amountTooHigh ? (
              <div className="rdm-input-error-text">
                {(uzsMethodSelected ? t("accounts.amountExceedsMaxUzs", lang) : t("accounts.amountExceedsMax", lang))
                  .replace("{max}", formatNumber(maxLimitDisplay, uzsMethodSelected ? 0 : 2, uzsMethodSelected ? 0 : 2))}
              </div>
            ) : null}

            <div className="rdm-hints">
              <span>{t("accounts.min", lang)}: {formatNumber(minLimitDisplay, uzsMethodSelected ? 0 : 2, uzsMethodSelected ? 0 : 2)} {inputCurrencyCode}</span>
              <span>{t("accounts.max", lang)}: {formatNumber(maxLimitDisplay, uzsMethodSelected ? 0 : 2, uzsMethodSelected ? 0 : 2)} {inputCurrencyCode}</span>
            </div>

            <div className="rdm-methods-block">
              <div className="rdm-methods-title">{t("accounts.paymentMethodChoose", lang)}</div>
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
                        if (disabled) return
                        const nextIsUzs = isUzsMethod(method.id)
                        const prevIsUzs = uzsMethodSelected
                        if (amountValid && hasRate && nextIsUzs !== prevIsUzs) {
                          const normalizedUSD = prevIsUzs ? amountNum / uzsRate : amountNum
                          const convertedInput = nextIsUzs ? normalizedUSD * uzsRate : normalizedUSD
                          const nextAmount = normalizeAmountInput(String(convertedInput), !nextIsUzs)
                          setAmountRaw(nextAmount.raw)
                          setAmountDisplay(nextAmount.display)
                        } else if (amountDisplay) {
                          const normalized = normalizeAmountInput(amountDisplay, !nextIsUzs)
                          setAmountRaw(normalized.raw)
                          setAmountDisplay(normalized.display)
                        }
                        setMethodID(method.id)
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
              {selectedMethod?.enabled ? (
                <div className="rdm-method-details">
                  <span>{t("accounts.paymentMethodDetails", lang)}:</span>
                  <strong>{selectedMethod.details}</strong>
                </div>
              ) : (
                <div className="acm-note" style={{ textAlign: "left", color: "#f59e0b" }}>
                  {paymentMethods.length === 0 ? t("accounts.noPaymentMethods", lang) : t("accounts.paymentMethodRequired", lang)}
                </div>
              )}
            </div>

            {uzsMethodSelected ? (
              <div className="rdm-uzs-notice">
                {t("accounts.uzsPaymentNotice", lang)}
              </div>
            ) : null}

            <div className="rdm-vouchers">
              <button
                type="button"
                className={`rdm-voucher-btn ${voucherKind === "none" ? "active" : ""}`}
                onClick={() => setVoucherKind("none")}
              >
                {t("accounts.noVoucher", lang)}
              </button>
              {vouchers.map(v => {
                const selected = voucherKind === v.id
                const amountBlocked = v.id === "diamond" && Number.isFinite(amountUSDForValidation) && amountUSDForValidation < DIAMOND_MIN_AMOUNT
                const disabled = !v.available || amountBlocked
                return (
                  <button
                    key={v.id}
                    type="button"
                    className={`rdm-voucher-btn ${selected ? "active" : ""}`}
                    disabled={disabled}
                    onClick={() => {
                      if (v.id === "diamond" && (!Number.isFinite(amountUSDForValidation) || amountUSDForValidation < DIAMOND_MIN_AMOUNT)) {
                        const forcedValue = uzsMethodSelected ? DIAMOND_MIN_AMOUNT * uzsRate : DIAMOND_MIN_AMOUNT
                        const forced = normalizeAmountInput(String(forcedValue), !uzsMethodSelected)
                        setAmountRaw(forced.raw)
                        setAmountDisplay(forced.display)
                        return
                      }
                      setVoucherKind(v.id)
                    }}
                  >
                    <Gift size={14} />
                    <span>{v.title}</span>
                    <strong>{v.percent}%</strong>
                  </button>
                )
              })}
            </div>
              <div className="acm-note" style={{ textAlign: "left" }}>
              {t("accounts.diamondOnlyFrom", lang).replace("{amount}", formatNumber(DIAMOND_MIN_AMOUNT, 0, 0))}
            </div>

            <div className="rdm-calc-card">
              <div className="rdm-calc-row">
                <span>{t("accounts.deposit", lang)}</span>
                <strong>
                  {formatNumber(amountValid ? amountNum : 0, uzsMethodSelected ? 0 : 2, uzsMethodSelected ? 0 : 2)} {inputCurrencyCode}
                </strong>
              </div>
              {uzsMethodSelected ? (
                <div className="rdm-calc-row rdm-calc-row-copy">
                  <span>{t("accounts.exactTransferUzs", lang)}</span>
                  <div className="rdm-copy-wrap">
                    <strong>{formatNumber(amountValid ? amountNum : 0, 0, 0)} UZS</strong>
                    <button
                      type="button"
                      className="rdm-copy-btn"
                      disabled={!amountValid}
                      onClick={async () => {
                        const exact = formatNumber(amountValid ? amountNum : 0, 0, 0).replace(/\s+/g, " ")
                        const copied = await copyToClipboard(exact)
                        if (copied) toast.success(t("accounts.copied", lang))
                      }}
                    >
                      <Copy size={14} />
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="rdm-calc-row">
                <span>{t("accounts.bonus", lang)}</span>
                <strong>
                  +{formatNumber(bonusAmount, 2, 2)} USD {activeVoucherPercent > 0 ? `(${activeVoucherPercent}%)` : ""}
                </strong>
              </div>
              <div className="rdm-calc-row total">
                <span>{t("accounts.totalCredit", lang)}</span>
                <strong>{formatNumber(totalAmount, 2, 2)} USD</strong>
              </div>
              <div className="rdm-calc-rate">
                {t("accounts.rateLine", lang).replace("{rate}", formatNumber(uzsRate, 2, 2))}
              </div>
            </div>

            <div
              className={`rdm-dropzone ${dragOver ? "drag-over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault()
                if (!loading) setDragOver(true)
              }}
              onDragLeave={(e) => {
                e.preventDefault()
                setDragOver(false)
              }}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                if (loading) return
                pickProof(e.dataTransfer.files?.[0])
              }}
            >
              <Upload size={18} />
              <div className="rdm-drop-title">{t("accounts.uploadPaymentProof", lang)}</div>
              <div className="rdm-drop-sub">{t("accounts.dragDropProof", lang)}</div>
              <button
                type="button"
                className="rdm-choose-btn"
                disabled={loading}
                onClick={() => fileInputRef.current?.click()}
              >
                {t("accounts.chooseFile", lang)}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="rdm-file-input"
                accept="image/*,.pdf,.jpeg,.jpg,.png,.webp"
                onChange={e => pickProof(e.target.files?.[0])}
              />
              {proofFile && (
                <div className="rdm-proof-picked">
                  <CheckCircle2 size={14} />
                  <span>{proofFile.name}</span>
                </div>
              )}
            </div>

            {status?.pending_count ? (
              <div className="acm-note" style={{ textAlign: "left" }}>
                {t("accounts.pendingRequestsNewAlsoReviewed", lang).replace("{count}", String(status.pending_count))}
              </div>
            ) : null}

            {!allowVouchers ? (
              <div className="acm-note" style={{ textAlign: "left", color: "#f59e0b" }}>
                {t("accounts.voucherOnlyRealStandard", lang)}
              </div>
            ) : null}
          </div>
        </div>

        <div className="acm-footer">
          <button
            type="button"
            className="acm-submit-btn"
            disabled={disabledSubmit}
            onClick={async () => {
              if (uzsMethodSelected && !hasRate) {
                toast.error(t("accounts.uzsRateUnavailable", lang))
                return
              }
              if (!withinLimits) {
                toast.error(
                  (uzsMethodSelected ? t("accounts.amountBetweenUzs", lang) : t("accounts.amountBetween", lang))
                    .replace("{min}", formatNumber(minLimitDisplay, uzsMethodSelected ? 0 : 2, uzsMethodSelected ? 0 : 2))
                    .replace("{max}", formatNumber(maxLimitDisplay, uzsMethodSelected ? 0 : 2, uzsMethodSelected ? 0 : 2))
                )
                return
              }
              if (!Number.isFinite(amountUSDForValidation)) {
                toast.error(t("accounts.errors.enterValidAmount", lang))
                return
              }
              if (voucherKind === "diamond" && amountUSDForValidation < DIAMOND_MIN_AMOUNT) {
                toast.error(t("accounts.diamondRequires", lang).replace("{amount}", formatNumber(DIAMOND_MIN_AMOUNT, 0, 0)))
                return
              }
              if (!proofFile) {
                toast.error(t("accounts.uploadPaymentProof", lang))
                return
              }
              if (!selectedMethod || !selectedMethod.enabled) {
                toast.error(t("accounts.paymentMethodRequired", lang))
                return
              }

              await onSubmit({
                amountUSD: amountToApi(amountUSDForValidation),
                voucherKind,
                methodID: selectedMethod.id,
                proofFile,
              })
            }}
          >
            {loading ? t("common.sending", lang) : t("accounts.submitReviewMin", lang).replace("{minutes}", String(reviewMinutes))}
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
