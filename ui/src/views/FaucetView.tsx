import { motion } from "framer-motion"
import { Droplet, Sparkles, Wallet } from "lucide-react"
import { PanelMotion } from "../types/ui"
import { Balance } from "../types/domain"
import FaucetForm from "../components/FaucetForm"
import BalancesList from "../components/BalancesList"

type Props = {
  t: (key: string) => string
  panelMotion: PanelMotion
  apiBase: string
  balances: Balance[]
  onLoadBalances: () => void
  faucetAsset: string
  faucetAmount: string
  faucetReference: string
  onFaucetAssetChange: (value: string) => void
  onFaucetAmountChange: (value: string) => void
  onFaucetReferenceChange: (value: string) => void
  onFaucetSubmit: (form: HTMLFormElement) => void
  faucetBusy: boolean
  faucetResult: string
}

export default function FaucetView({
  t,
  panelMotion,
  apiBase,
  balances,
  onLoadBalances,
  faucetAsset,
  faucetAmount,
  faucetReference,
  onFaucetAssetChange,
  onFaucetAmountChange,
  onFaucetReferenceChange,
  onFaucetSubmit,
  faucetBusy,
  faucetResult
}: Props) {
  return (
    <div id="faucet" className="stack">
      <motion.section className="panel hero" {...panelMotion}>
        <div className="panel-head">
          <div className="panel-title">
            <Droplet size={16} />
            {t("faucetTitle")}
          </div>
          <div className="row">
            <span className="tag">
              <Sparkles size={14} />
              {t("faucetFast")}
            </span>
            <span className="tag">{t("faucetHint")}</span>
          </div>
        </div>
        <div className="faucet-grid">
          <div className="faucet-copy">
            <div className="faucet-title">{t("faucetSubtitle")}</div>
            <div className="faucet-note">
              {t("baseUrl")}: {apiBase}
            </div>
          </div>
          <FaucetForm
            t={t}
            asset={faucetAsset}
            amount={faucetAmount}
            reference={faucetReference}
            onAssetChange={onFaucetAssetChange}
            onAmountChange={onFaucetAmountChange}
            onReferenceChange={onFaucetReferenceChange}
            onSubmit={onFaucetSubmit}
            busy={faucetBusy}
            className="card faucet-card"
            assetLocked
          />
        </div>
        {faucetResult ? <pre className="output">{faucetResult}</pre> : null}
      </motion.section>
      <motion.section className="panel" {...panelMotion}>
        <div className="panel-head">
          <div className="panel-title">
            <Wallet size={16} />
            {t("faucetBalances")}
          </div>
          <button className="ghost" onClick={onLoadBalances}>
            {t("loadBalances")}
          </button>
        </div>
        <BalancesList t={t} balances={balances} />
      </motion.section>
    </div>
  )
}
