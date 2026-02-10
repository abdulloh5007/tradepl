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
    <div className="acc-modal-overlay" role="dialog" aria-modal="true">
      <button type="button" className="acc-modal-backdrop" onClick={onClose} aria-label={`Close ${title}`} />
      <div className="acc-modal">
        <div className="acc-modal-title">{title}</div>
        {disabled ? (
          <div className="acc-modal-note">{disabledText}</div>
        ) : (
          <>
            <label className="acc-modal-label">
              Amount (USD)
              <input
                type="number"
                min="1"
                step="0.01"
                value={amount}
                onChange={e => onAmountChange(e.target.value)}
                placeholder="100.00"
              />
            </label>
            <div className="acc-modal-note">
              {type === "deposit" ? "Funds will be credited instantly to demo account." : "Funds will be removed from demo account."}
            </div>
          </>
        )}
        <div className="acc-modal-actions">
          <button type="button" className="acc-action-btn ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="acc-action-btn"
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
