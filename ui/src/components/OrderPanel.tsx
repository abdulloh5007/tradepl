import { useState } from "react"
import { motion } from "framer-motion"
import { Rocket } from "lucide-react"
import SmartDropdown from "./ui/SmartDropdown"
import { PanelMotion } from "../types/ui"

type Props = {
  t: (key: string) => string
  panelMotion: PanelMotion
  onSubmit: (form: HTMLFormElement) => void
  result: string
}

export default function OrderPanel({ t, panelMotion, onSubmit, result }: Props) {
  const [side, setSide] = useState<"buy" | "sell">("buy")
  const [orderType, setOrderType] = useState<"limit" | "market">("limit")
  const [tif, setTif] = useState<"gtc" | "ioc">("gtc")

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
          <input type="hidden" name="side" value={side} />
          <SmartDropdown
            value={side}
            options={[
              { value: "buy", label: "Buy" },
              { value: "sell", label: "Sell" }
            ]}
            onChange={next => setSide(String(next) as "buy" | "sell")}
            ariaLabel="Order side"
            className="field-dropdown"
          />
        </label>
        <label className="field">
          <span>{t("type")}</span>
          <input type="hidden" name="type" value={orderType} />
          <SmartDropdown
            value={orderType}
            options={[
              { value: "limit", label: "Limit" },
              { value: "market", label: "Market" }
            ]}
            onChange={next => setOrderType(String(next) as "limit" | "market")}
            ariaLabel="Order type"
            className="field-dropdown"
          />
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
          <input type="hidden" name="time_in_force" value={tif} />
          <SmartDropdown
            value={tif}
            options={[
              { value: "gtc", label: "GTC" },
              { value: "ioc", label: "IOC" }
            ]}
            onChange={next => setTif(String(next) as "gtc" | "ioc")}
            ariaLabel="Time in force"
            className="field-dropdown"
          />
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
