import { motion } from "framer-motion"
import { Activity, Wallet } from "lucide-react"
import { PanelMotion } from "../types/ui"
import { Balance } from "../types/domain"
import BalanceCard from "./BalanceCard"
import AccountMetrics from "./AccountMetrics"

type Props = {
  t: (key: string) => string
  panelMotion: PanelMotion
  profile: string
  onLoadProfile: () => void
  balances: Balance[]
  onLoadBalances: () => void
  balanceLabel: string
  equity: string
  marginUsed: string
  freeMargin: string
  marginLevel: string
  floatingPnL: string
  currency: string
}

export default function AccountPanel({
  t,
  panelMotion,
  profile,
  onLoadProfile,
  balances,
  onLoadBalances,
  balanceLabel,
  equity,
  marginUsed,
  freeMargin,
  marginLevel,
  floatingPnL,
  currency
}: Props) {
  return (
    <motion.section className="panel" {...panelMotion}>
      <div className="panel-head">
        <div className="panel-title">
          <Wallet size={16} />
          {t("account")}
        </div>
      </div>
      <div className="grid two">
        <div className="card">
          <div className="card-title">
            <Activity size={16} />
            {t("profile")}
          </div>
          <button className="ghost" onClick={onLoadProfile}>
            {t("loadProfile")}
          </button>
          <pre className="output">{profile}</pre>
        </div>
        <div className="card">
          <div className="card-title">{t("accountMetrics")}</div>
          <AccountMetrics
            t={t}
            balance={balanceLabel}
            equity={equity}
            marginUsed={marginUsed}
            freeMargin={freeMargin}
            marginLevel={marginLevel}
            floatingPnL={floatingPnL}
            currency={currency}
          />
        </div>
      </div>
      <div className="spacer" />
      <BalanceCard t={t} balances={balances} onLoad={onLoadBalances} />
    </motion.section>
  )
}
