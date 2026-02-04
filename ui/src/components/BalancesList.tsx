import { Balance } from "../types/domain"

type Props = {
  t: (key: string) => string
  balances: Balance[]
}

export default function BalancesList({ t, balances }: Props) {
  if (balances.length === 0) {
    return <div className="balance-empty">{t("balanceEmpty")}</div>
  }
  return (
    <div className="balance-list">
      {balances.map(item => (
        <div key={`${item.symbol}-${item.kind}`} className="balance-item">
          <div className="balance-main">
            <div className="balance-symbol">{item.symbol}</div>
            <div className="balance-kind">{item.kind}</div>
          </div>
          <div className="balance-amount">{item.amount}</div>
        </div>
      ))}
    </div>
  )
}
