import { useEffect, useMemo, useRef, useState } from "react"
import { CheckCircle2, Gift, Upload, X } from "lucide-react"
import { toast } from "sonner"
import type { DepositBonusStatus } from "../../api"
import type { Lang } from "../../types"
import { formatNumber } from "../../utils/format"
import { t } from "../../utils/i18n"
import { useAnimatedPresence } from "../../hooks/useAnimatedPresence"
import "./RealDepositRequestModal.css"

type VoucherKind = "none" | "gold" | "diamond"

interface RealDepositRequestModalProps {
  lang: Lang
  open: boolean
  status: DepositBonusStatus | null
  allowVouchers: boolean
  defaultVoucher?: VoucherKind
  loading: boolean
  onClose: () => void
  onSubmit: (payload: {
    amountUSD: string
    voucherKind: VoucherKind
    proofFile: File
  }) => Promise<void>
}

const MAX_PROOF_SIZE = 5 * 1024 * 1024
const DIAMOND_MIN_AMOUNT = 200

const normalizeVoucherKind = (value?: string): VoucherKind => {
  const v = String(value || "").trim().toLowerCase()
  if (v === "gold" || v === "diamond") return v
  return "none"
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

export default function RealDepositRequestModal({
  lang,
  open,
  status,
  allowVouchers,
  defaultVoucher = "none",
  loading,
  onClose,
  onSubmit,
}: RealDepositRequestModalProps) {
  const { shouldRender, isVisible } = useAnimatedPresence(open, 220)
  const [amountRaw, setAmountRaw] = useState("")
  const [amountDisplay, setAmountDisplay] = useState("")
  const [voucherKind, setVoucherKind] = useState<VoucherKind>("none")
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const minAmount = Number(status?.min_amount_usd || "0")
  const maxAmount = Number(status?.max_amount_usd || "0")
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

  const availableVoucherIds = useMemo(() => {
    return vouchers.filter(v => v.available).map(v => v.id)
  }, [vouchers])

  const amountNum = Number(amountRaw)
  const amountValid = Number.isFinite(amountNum) && amountNum > 0
  const amountTooHigh = amountValid && maxAmount > 0 && amountNum > maxAmount
  const withinLimits = amountValid && amountNum >= minAmount && amountNum <= maxAmount

  const activeVoucherPercent = useMemo(() => {
    if (voucherKind === "none") return 0
    const item = vouchers.find(v => v.id === voucherKind)
    if (!item || !item.available) return 0
    return item.percent
  }, [vouchers, voucherKind])

  const bonusAmount = amountValid ? (amountNum * activeVoucherPercent) / 100 : 0
  const totalAmount = amountValid ? amountNum + bonusAmount : 0
  const amountUZS = amountValid ? amountNum * uzsRate : 0

  const resetState = () => {
    const preferred = normalizeVoucherKind(defaultVoucher)
    const baseDefaultAmount = minAmount > 0 ? minAmount : 0
    const forcedAmount = preferred === "diamond" ? Math.max(baseDefaultAmount, DIAMOND_MIN_AMOUNT) : baseDefaultAmount
    const initialAmount = forcedAmount > 0 ? String(forcedAmount) : ""
    setAmountRaw(initialAmount)
    setAmountDisplay(initialAmount ? formatIntWithSpaces(initialAmount) : "")
    setProofFile(null)
    setDragOver(false)

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
  }, [open, defaultVoucher, status?.eligible_account_id, status?.pending_count, status?.vouchers])

  useEffect(() => {
    if (voucherKind === "diamond" && amountValid && amountNum < DIAMOND_MIN_AMOUNT) {
      setVoucherKind("none")
    }
  }, [voucherKind, amountValid, amountNum])

  useEffect(() => {
    if (voucherKind === "none") return
    if (!availableVoucherIds.includes(voucherKind)) {
      if (availableVoucherIds.length > 0) setVoucherKind(availableVoucherIds[0])
      else setVoucherKind("none")
    }
  }, [voucherKind, availableVoucherIds])

  if (!shouldRender) return null

  const pickProof = (file?: File | null) => {
    if (!file) return
    if (file.size > MAX_PROOF_SIZE) {
      toast.error(t("accounts.depositProofTooLarge", lang))
      return
    }
    setProofFile(file)
  }

  const disabledSubmit = loading || !withinLimits || !proofFile

  return (
    <div className={`acm-overlay ${isVisible ? "is-open" : "is-closing"}`} role="dialog" aria-modal="true">
      <div className="acm-backdrop" onClick={() => {
        if (!loading) onClose()
      }} />
      <div className="acm-sheet">
        <div className="acm-header">
          <button onClick={() => {
            if (!loading) onClose()
          }} className="acm-close-btn">
            <X size={24} />
          </button>
          <h2 className="acm-title">{t("accounts.realDeposit", lang)}</h2>
          <div className="acm-spacer" />
        </div>

        <div className="acm-content">
          <div className="acm-form rdm-form">
            <label className="acm-label">
              {t("accounts.amountUsd", lang)}
              <input
                className={`acm-input ${amountTooHigh ? "rdm-input-error" : ""}`}
                inputMode="decimal"
                value={amountDisplay}
                onChange={e => {
                  const next = normalizeAmountInput(e.target.value)
                  setAmountRaw(next.raw)
                  setAmountDisplay(next.display)
                }}
                placeholder={t("accounts.amountPlaceholder", lang)}
              />
            </label>
            {amountTooHigh ? (
              <div className="rdm-input-error-text">
                {t("accounts.amountExceedsMax", lang).replace("{max}", formatNumber(maxAmount, 2, 2))}
              </div>
            ) : null}

            <div className="rdm-hints">
              <span>{t("accounts.min", lang)}: {formatNumber(minAmount, 2, 2)} USD</span>
              <span>{t("accounts.max", lang)}: {formatNumber(maxAmount, 2, 2)} USD</span>
            </div>

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
                const amountBlocked = v.id === "diamond" && amountValid && amountNum < DIAMOND_MIN_AMOUNT
                const disabled = !v.available || amountBlocked
                return (
                  <button
                    key={v.id}
                    type="button"
                    className={`rdm-voucher-btn ${selected ? "active" : ""}`}
                    disabled={disabled}
                    onClick={() => {
                      if (v.id === "diamond" && amountNum < DIAMOND_MIN_AMOUNT) {
                        const forced = normalizeAmountInput(String(DIAMOND_MIN_AMOUNT))
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
                <strong>{formatNumber(amountValid ? amountNum : 0, 2, 2)} USD</strong>
              </div>
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
                {formatNumber(amountUZS, 0, 0)} UZS at rate {formatNumber(uzsRate, 2, 2)}
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
              if (!withinLimits) {
                toast.error(
                  t("accounts.amountBetween", lang)
                    .replace("{min}", formatNumber(minAmount, 2, 2))
                    .replace("{max}", formatNumber(maxAmount, 2, 2))
                )
                return
              }
              if (voucherKind === "diamond" && amountNum < DIAMOND_MIN_AMOUNT) {
                toast.error(t("accounts.diamondRequires", lang).replace("{amount}", formatNumber(DIAMOND_MIN_AMOUNT, 0, 0)))
                return
              }
              if (!proofFile) {
                toast.error(t("accounts.uploadPaymentProof", lang))
                return
              }

              await onSubmit({
                amountUSD: amountToApi(amountRaw),
                voucherKind,
                proofFile,
              })
            }}
          >
            {loading ? t("common.sending", lang) : t("accounts.submitReviewMin", lang).replace("{minutes}", String(reviewMinutes))}
          </button>
        </div>
      </div>
    </div>
  )
}
