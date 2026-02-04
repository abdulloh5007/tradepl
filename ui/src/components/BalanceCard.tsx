import { Coins } from "lucide-react"
import BalancesList from "./BalancesList"
import { Balance } from "../types/domain"

type Props = {
  t: (key: string) => string
  balances: Balance[]
  onLoad: () => void
}

export default function BalanceCard({ t, balances, onLoad }: Props) {
  return (
    <div className="card balance-card">
      <div className="card-title">
        <Coins size={16} />
        {t("balances")}
      </div>
      <div className="row">
        <button className="ghost" onClick={onLoad}>
          {t("loadBalances")}
        </button>
      </div>
      <BalancesList t={t} balances={balances} />
    </div>
  )
}
