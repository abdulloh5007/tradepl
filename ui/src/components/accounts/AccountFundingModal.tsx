import { X } from "lucide-react"
import "./SharedAccountSheet.css"

interface AccountFundingModalProps {
  open: boolean
  mode: "demo" | "real"
  type: "deposit" | "withdraw"
  amount: string
  onAmountChange: (amount: string) => void
  onClose: () => void
  onSubmit: () => Promise<void>
  loading: boolean
}

export default function AccountFundingModal({
  open,
  mode,
  type,
  amount,
  onAmountChange,
  onClose,
  onSubmit,
  loading
}: AccountFundingModalProps) {
  if (!open) return null
  const title = type === "deposit" ? "Deposit" : "Withdraw"
  const disabled = mode !== "demo"
  const disabledText = type === "deposit" ? "Real deposit is not available yet" : "Real withdraw is not available yet"

  return (
    <div className="acm-overlay" role="dialog" aria-modal="true">
      <div className="acm-backdrop" onClick={onClose} />
      <div className="acm-sheet">
        <div className="acm-header">
          <button onClick={onClose} className="acm-close-btn">
            <X size={24} />
          </button>
          <h2 className="acm-title">{title} - {mode === "demo" ? "Demo" : "Real"}</h2>
          <div className="acm-spacer" />
        </div>

        <div className="acm-content">
          <div className="acm-form">
            {disabled ? (
              <div className="acm-note" style={{ padding: "40px 20px" }}>{disabledText}</div>
            ) : (
              <>
                <label className="acm-label">
                  Amount (USD)
                  <input
                    className="acm-input"
                    type="number"
                    min="1"
                    step="0.01"
                    value={amount}
                    onChange={e => onAmountChange(e.target.value)}
                    placeholder="100.00"
                  />
                </label>
                <div className="acm-note" style={{ textAlign: "left" }}>
                  {type === "deposit" ? "Funds will be credited instantly to demo account." : "Funds will be removed from demo account."}
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
            {loading ? "Processing..." : title}
          </button>
        </div>
      </div>
    </div>
  )
}
