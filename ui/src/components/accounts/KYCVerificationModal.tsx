import { useEffect, useRef, useState } from "react"
import { CheckCircle2, IdCard, X } from "lucide-react"
import { toast } from "sonner"
import type { KYCStatus } from "../../api"
import type { Lang } from "../../types"
import SmartDropdown from "../ui/SmartDropdown"
import type { SmartDropdownOption } from "../ui/SmartDropdown"
import { t } from "../../utils/i18n"
import { useAnimatedPresence } from "../../hooks/useAnimatedPresence"
import "./KYCVerificationModal.css"

type KYCDocumentType = "passport" | "id_card" | "driver_license" | "other"

interface KYCVerificationModalProps {
  lang: Lang
  open: boolean
  status: KYCStatus | null
  loading: boolean
  onClose: () => void
  onSubmit: (payload: {
    documentType: KYCDocumentType
    fullName: string
    documentNumber: string
    residenceAddress: string
    frontProofFile: File
    backProofFile: File
  }) => Promise<void>
}

const MAX_KYC_PROOF_SIZE = 10 * 1024 * 1024

const formatDocumentNumberInput = (raw: string) => {
  const lettersOnly = raw.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2)
  const digitsOnly = raw.replace(/\D/g, "").slice(0, 18)
  if (!lettersOnly && !digitsOnly) return ""
  if (!lettersOnly) return digitsOnly
  if (!digitsOnly) return lettersOnly.length >= 2 ? `${lettersOnly} | ` : lettersOnly
  return `${lettersOnly} | ${digitsOnly}`
}

const normalizeDocumentNumber = (formatted: string) =>
  formatted.toUpperCase().replace(/[^A-Z0-9]/g, "")

export default function KYCVerificationModal({
  lang,
  open,
  status,
  loading,
  onClose,
  onSubmit,
}: KYCVerificationModalProps) {
  const { shouldRender, isVisible } = useAnimatedPresence(open, 220)
  const [documentType, setDocumentType] = useState<KYCDocumentType>("passport")
  const [fullName, setFullName] = useState("")
  const [documentNumber, setDocumentNumber] = useState("")
  const [residenceAddress, setResidenceAddress] = useState("")
  const [frontProofFile, setFrontProofFile] = useState<File | null>(null)
  const [backProofFile, setBackProofFile] = useState<File | null>(null)
  const frontFileInputRef = useRef<HTMLInputElement | null>(null)
  const backFileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    setDocumentType("passport")
    setFullName("")
    setDocumentNumber("")
    setResidenceAddress("")
    setFrontProofFile(null)
    setBackProofFile(null)
  }, [open])

  if (!shouldRender) return null

  const pickProof = (side: "front" | "back", file?: File | null) => {
    if (!file) return
    if (!file.type.startsWith("image/")) {
      toast.error(t("kyc.imagesOnly", lang))
      return
    }
    if (file.size > MAX_KYC_PROOF_SIZE) {
      toast.error(t("kyc.fileTooLarge", lang))
      return
    }
    if (side === "front") {
      setFrontProofFile(file)
      return
    }
    setBackProofFile(file)
  }

  const documentNumberNormalized = normalizeDocumentNumber(documentNumber)
  const canSubmit = Boolean(
    status?.can_submit &&
    !loading &&
    fullName.trim().length >= 3 &&
    documentNumberNormalized.length >= 3 &&
    residenceAddress.trim().length >= 6 &&
    frontProofFile &&
    backProofFile
  )
  const reviewHours = Number(status?.review_eta_hours || 8)
  const KYC_DOCUMENT_OPTIONS: SmartDropdownOption[] = [
    { value: "passport", label: t("kyc.document.passport", lang) },
    { value: "id_card", label: t("kyc.document.idCard", lang) },
    { value: "driver_license", label: t("kyc.document.driverLicense", lang) },
    { value: "other", label: t("kyc.document.other", lang) },
  ]

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
          <h2 className="acm-title">{t("kyc.title", lang)}</h2>
          <div className="acm-spacer" />
        </div>

        <div className="acm-content">
          <div className="acm-form kyc-form">
            <label className="acm-label">
              {t("kyc.documentType", lang)}
              <SmartDropdown
                className="acm-dropdown"
                value={documentType}
                options={KYC_DOCUMENT_OPTIONS}
                onChange={(value) => setDocumentType(String(value) as KYCDocumentType)}
                disabled={loading}
                ariaLabel={t("kyc.documentType", lang)}
              />
            </label>

            <label className="acm-label">
              {t("kyc.fullName", lang)}
              <input
                className="acm-input"
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder={t("kyc.fullNamePlaceholder", lang)}
                maxLength={140}
                disabled={loading}
              />
            </label>

            <label className="acm-label">
              {t("kyc.documentNumber", lang)}
              <input
                className="acm-input"
                type="text"
                value={documentNumber}
                onChange={e => setDocumentNumber(formatDocumentNumberInput(e.target.value))}
                placeholder="AD | 1234567"
                maxLength={80}
                disabled={loading}
              />
            </label>

            <label className="acm-label">
              {t("kyc.residenceAddress", lang)}
              <textarea
                className="acm-input kyc-textarea"
                value={residenceAddress}
                onChange={e => setResidenceAddress(e.target.value)}
                placeholder={t("kyc.addressPlaceholder", lang)}
                maxLength={280}
                disabled={loading}
              />
            </label>

            <div className="kyc-files-grid">
              <div className="kyc-dropzone">
                <div className="kyc-side-icon front" aria-hidden="true">
                  <IdCard size={24} />
                </div>
                <div className="kyc-drop-title">{t("kyc.frontSide", lang)}</div>
                <button
                  type="button"
                  className="kyc-choose-btn"
                  disabled={loading}
                  onClick={() => frontFileInputRef.current?.click()}
                >
                  {t("kyc.chooseFront", lang)}
                </button>
                <input
                  ref={frontFileInputRef}
                  type="file"
                  className="kyc-file-input"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={e => pickProof("front", e.target.files?.[0])}
                />
                {frontProofFile && (
                  <div className="kyc-proof-picked">
                    <CheckCircle2 size={14} />
                    <span>{frontProofFile.name}</span>
                  </div>
                )}
              </div>

              <div className="kyc-dropzone">
                <div className="kyc-side-icon back" aria-hidden="true">
                  <IdCard size={24} />
                </div>
                <div className="kyc-drop-title">{t("kyc.backSide", lang)}</div>
                <button
                  type="button"
                  className="kyc-choose-btn"
                  disabled={loading}
                  onClick={() => backFileInputRef.current?.click()}
                >
                  {t("kyc.chooseBack", lang)}
                </button>
                <input
                  ref={backFileInputRef}
                  type="file"
                  className="kyc-file-input"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={e => pickProof("back", e.target.files?.[0])}
                />
                {backProofFile && (
                  <div className="kyc-proof-picked">
                    <CheckCircle2 size={14} />
                    <span>{backProofFile.name}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="acm-note" style={{ textAlign: "left" }}>
              {t("kyc.reviewEta", lang).replace("{hours}", String(reviewHours))}
            </div>
          </div>
        </div>

        <div className="acm-footer">
          <button
            type="button"
            className="acm-submit-btn"
            disabled={!canSubmit}
            onClick={async () => {
              if (!status?.can_submit) {
                toast.error(status?.message || t("kyc.unavailable", lang))
                return
              }
              if (!frontProofFile || !backProofFile) {
                toast.error(t("kyc.uploadBothSides", lang))
                return
              }
              await onSubmit({
                documentType,
                fullName: fullName.trim(),
                documentNumber: documentNumberNormalized,
                residenceAddress: residenceAddress.trim(),
                frontProofFile,
                backProofFile,
              })
            }}
          >
            {loading ? t("common.submitting", lang) : t("kyc.submit", lang)}
          </button>
        </div>
      </div>
    </div>
  )
}
