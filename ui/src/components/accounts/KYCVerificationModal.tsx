import { useEffect, useRef, useState } from "react"
import { CheckCircle2, Upload, X } from "lucide-react"
import { toast } from "sonner"
import type { KYCStatus } from "../../api"
import "./KYCVerificationModal.css"

type KYCDocumentType = "passport" | "id_card" | "driver_license" | "other"

interface KYCVerificationModalProps {
  open: boolean
  status: KYCStatus | null
  loading: boolean
  onClose: () => void
  onSubmit: (payload: {
    documentType: KYCDocumentType
    fullName: string
    documentNumber: string
    residenceAddress: string
    notes?: string
    proofFile: File
  }) => Promise<void>
}

const MAX_KYC_PROOF_SIZE = 10 * 1024 * 1024

export default function KYCVerificationModal({
  open,
  status,
  loading,
  onClose,
  onSubmit,
}: KYCVerificationModalProps) {
  const [documentType, setDocumentType] = useState<KYCDocumentType>("passport")
  const [fullName, setFullName] = useState("")
  const [documentNumber, setDocumentNumber] = useState("")
  const [residenceAddress, setResidenceAddress] = useState("")
  const [notes, setNotes] = useState("")
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    setDocumentType("passport")
    setFullName("")
    setDocumentNumber("")
    setResidenceAddress("")
    setNotes("")
    setProofFile(null)
    setDragOver(false)
  }, [open])

  if (!open) return null

  const pickProof = (file?: File | null) => {
    if (!file) return
    if (file.size > MAX_KYC_PROOF_SIZE) {
      toast.error("Proof file is too large (max 10MB)")
      return
    }
    setProofFile(file)
  }

  const canSubmit = Boolean(
    status?.can_submit &&
    !loading &&
    fullName.trim().length >= 3 &&
    documentNumber.trim().length >= 3 &&
    residenceAddress.trim().length >= 6 &&
    proofFile
  )
  const reviewHours = Number(status?.review_eta_hours || 8)

  return (
    <div className="acm-overlay" role="dialog" aria-modal="true">
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
          <h2 className="acm-title">Identity Verification</h2>
          <div className="acm-spacer" />
        </div>

        <div className="acm-content">
          <div className="acm-form kyc-form">
            <label className="acm-label">
              Document type
              <select
                className="acm-select"
                value={documentType}
                onChange={e => setDocumentType(e.target.value as KYCDocumentType)}
                disabled={loading}
              >
                <option value="passport">Passport</option>
                <option value="id_card">ID card</option>
                <option value="driver_license">Driver license</option>
                <option value="other">Other</option>
              </select>
            </label>

            <label className="acm-label">
              Full name
              <input
                className="acm-input"
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="As in your document"
                maxLength={140}
                disabled={loading}
              />
            </label>

            <label className="acm-label">
              Document number
              <input
                className="acm-input"
                type="text"
                value={documentNumber}
                onChange={e => setDocumentNumber(e.target.value)}
                placeholder="AA1234567"
                maxLength={80}
                disabled={loading}
              />
            </label>

            <label className="acm-label">
              Residence address
              <textarea
                className="acm-input kyc-textarea"
                value={residenceAddress}
                onChange={e => setResidenceAddress(e.target.value)}
                placeholder="City, district, street, house"
                maxLength={280}
                disabled={loading}
              />
            </label>

            <label className="acm-label">
              Notes (optional)
              <textarea
                className="acm-input kyc-textarea"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Any additional information"
                maxLength={500}
                disabled={loading}
              />
            </label>

            <div
              className={`kyc-dropzone ${dragOver ? "drag-over" : ""}`}
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
              <div className="kyc-drop-title">Upload document proof</div>
              <div className="kyc-drop-sub">PNG, JPG, WEBP, PDF up to 10MB</div>
              <button
                type="button"
                className="kyc-choose-btn"
                disabled={loading}
                onClick={() => fileInputRef.current?.click()}
              >
                Choose file
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="kyc-file-input"
                accept="image/*,.pdf,.jpeg,.jpg,.png,.webp"
                onChange={e => pickProof(e.target.files?.[0])}
              />
              {proofFile && (
                <div className="kyc-proof-picked">
                  <CheckCircle2 size={14} />
                  <span>{proofFile.name}</span>
                </div>
              )}
            </div>

            <div className="acm-note" style={{ textAlign: "left" }}>
              Review usually takes about {reviewHours} hour(s). If rejected, next submission can be temporarily blocked.
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
                toast.error(status?.message || "KYC submission is not available now")
                return
              }
              if (!proofFile) {
                toast.error("Upload document proof")
                return
              }
              await onSubmit({
                documentType,
                fullName: fullName.trim(),
                documentNumber: documentNumber.trim(),
                residenceAddress: residenceAddress.trim(),
                notes: notes.trim(),
                proofFile,
              })
            }}
          >
            {loading ? "Submitting..." : "Submit KYC"}
          </button>
        </div>
      </div>
    </div>
  )
}
