type Props = {
  t: (key: string) => string
  balance: string
  equity: string
  marginUsed: string
  freeMargin: string
  marginLevel: string
  floatingPnL: string
  currency: string
}

export default function AccountMetrics({
  t,
  balance,
  equity,
  marginUsed,
  freeMargin,
  marginLevel,
  floatingPnL,
  currency
}: Props) {
  return (
    <div className="metrics">
      <div className="metric">
        <div className="metric-label">{t("balanceLabel")}</div>
        <div className="metric-value">{balance} {currency}</div>
      </div>
      <div className="metric">
        <div className="metric-label">{t("equity")}</div>
        <div className="metric-value">{equity} {currency}</div>
      </div>
      <div className="metric">
        <div className="metric-label">{t("marginUsed")}</div>
        <div className="metric-value">{marginUsed} {currency}</div>
      </div>
      <div className="metric">
        <div className="metric-label">{t("freeMargin")}</div>
        <div className="metric-value">{freeMargin} {currency}</div>
      </div>
      <div className="metric">
        <div className="metric-label">{t("marginLevel")}</div>
        <div className="metric-value">{marginLevel}</div>
      </div>
      <div className="metric">
        <div className="metric-label">{t("floatingPnL")}</div>
        <div className="metric-value">{floatingPnL} {currency}</div>
      </div>
    </div>
  )
}
