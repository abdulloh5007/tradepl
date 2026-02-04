import { motion } from "framer-motion"
import { Rocket } from "lucide-react"
import { PanelMotion } from "../types/ui"

type Props = {
  t: (key: string) => string
  panelMotion: PanelMotion
  onSubmit: (form: HTMLFormElement) => void
  result: string
}

export default function OrderPanel({ t, panelMotion, onSubmit, result }: Props) {
  return (
    <motion.section className="panel" {...panelMotion}>
      <div className="panel-head">
        <div className="panel-title">
          <Rocket size={16} />
          {t("order")}
        </div>
      </div>
      <form
        className="grid three"
        onSubmit={e => {
          e.preventDefault()
          onSubmit(e.currentTarget)
        }}
      >
        <label className="field">
          <span>{t("pair")}</span>
          <input name="pair" placeholder={t("pairPh")} defaultValue="UZS-USD" required />
        </label>
        <label className="field">
          <span>{t("side")}</span>
          <select name="side" required>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
        </label>
        <label className="field">
          <span>{t("type")}</span>
          <select name="type" required>
            <option value="limit">Limit</option>
            <option value="market">Market</option>
          </select>
        </label>
        <label className="field">
          <span>{t("price")}</span>
          <input name="price" placeholder={t("pricePh")} />
        </label>
        <label className="field">
          <span>{t("qty")}</span>
          <input name="qty" placeholder={t("qtyPh")} />
        </label>
        <label className="field">
          <span>{t("quoteAmount")}</span>
          <input name="quote_amount" placeholder={t("quoteAmountPh")} />
        </label>
        <label className="field">
          <span>{t("tif")}</span>
          <select name="time_in_force" required>
            <option value="gtc">GTC</option>
            <option value="ioc">IOC</option>
          </select>
        </label>
        <label className="field">
          <span>{t("clientRef")}</span>
          <input name="client_ref" placeholder={t("clientRefPh")} />
        </label>
        <button type="submit" className="primary">
          {t("placeOrder")}
        </button>
      </form>
      <pre className="output">{result}</pre>
    </motion.section>
  )
}
