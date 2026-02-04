type Props = {
  t: (key: string) => string
  asset: string
  amount: string
  reference: string
  onAssetChange: (value: string) => void
  onAmountChange: (value: string) => void
  onReferenceChange: (value: string) => void
  onSubmit: (form: HTMLFormElement) => void
  busy: boolean
  className?: string
  assetLocked?: boolean
}

export default function FaucetForm({
  t,
  asset,
  amount,
  reference,
  onAssetChange,
  onAmountChange,
  onReferenceChange,
  onSubmit,
  busy,
  className,
  assetLocked
}: Props) {
  return (
    <form
      className={className}
      onSubmit={e => {
        e.preventDefault()
        onSubmit(e.currentTarget)
      }}
    >
      {assetLocked ? (
        <>
          <input type="hidden" name="asset" value={asset} />
          <label className="field">
            <span>{t("faucetAsset")}</span>
            <input value={asset} disabled />
          </label>
        </>
      ) : (
        <label className="field">
          <span>{t("faucetAsset")}</span>
          <input name="asset" value={asset} onChange={e => onAssetChange(e.target.value)} required />
        </label>
      )}
      <label className="field">
        <span>{t("faucetAmount")}</span>
        <input name="amount" value={amount} onChange={e => onAmountChange(e.target.value)} required />
      </label>
      <label className="field">
        <span>{t("faucetReference")}</span>
        <input name="reference" value={reference} onChange={e => onReferenceChange(e.target.value)} placeholder={t("faucetReferencePh")} />
      </label>
      <button type="submit" className="primary" disabled={busy}>
        {t("faucetClaim")}
      </button>
    </form>
  )
}
