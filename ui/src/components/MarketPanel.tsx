import { motion } from "framer-motion"
import { ChartLine, Terminal } from "lucide-react"
import { PanelMotion } from "../types/ui"

type Props = {
  t: (key: string) => string
  panelMotion: PanelMotion
  marketPair: string
  marketPairs: string[]
  marketPrice: number
  marketPriceLabel: string
  timeframe: string
  timeframes: string[]
  onTimeframeChange: (value: string) => void
  bid?: string
  ask?: string
  spread?: string
  quickQty: string
  onMarketPairChange: (value: string) => void
  onQuickQtyChange: (value: string) => void
  onBuy: () => void
  onSell: () => void
  chartEl: React.RefObject<HTMLDivElement>
}

export default function MarketPanel({
  t,
  panelMotion,
  marketPair,
  marketPairs,
  marketPrice,
  marketPriceLabel,
  timeframe,
  timeframes,
  onTimeframeChange,
  bid,
  ask,
  spread,
  quickQty,
  onMarketPairChange,
  onQuickQtyChange,
  onBuy,
  onSell,
  chartEl
}: Props) {
  return (
    <motion.section className="panel" {...panelMotion}>
      <div className="panel-head">
        <div className="panel-title">
          <ChartLine size={16} />
          {t("market")}
        </div>
        <div className="row">
          <div className="segmented">
            {timeframes.map(item => (
              <button key={item} className={item === timeframe ? "active" : ""} onClick={() => onTimeframeChange(item)}>
                {item}
              </button>
            ))}
          </div>
          <span className="tag">{t("pair")}</span>
          <select className="select-compact" value={marketPair} onChange={e => onMarketPairChange(e.target.value)}>
            {marketPairs.map(pair => (
              <option key={pair} value={pair}>
                {pair}
              </option>
            ))}
          </select>
          <span className="tag">
            {t("lastPrice")}: {marketPriceLabel}
          </span>
          {bid && ask ? (
            <span className="tag">
              {t("bid")}: {bid} / {t("ask")}: {ask}
            </span>
          ) : null}
          {spread ? <span className="tag">{t("spread")}: {spread}</span> : null}
        </div>
      </div>
      <div className="grid two">
        <div className="card chart-card">
          <div ref={chartEl} className="chart" />
        </div>
        <div className="card">
          <div className="card-title">
            <Terminal size={16} />
            {t("quickTrade")}
          </div>
          <label className="field">
            <span>{t("amount")}</span>
            <input value={quickQty} onChange={e => onQuickQtyChange(e.target.value)} placeholder={t("qtyPh")} />
          </label>
          <div className="row">
            <button className="primary buy" onClick={onBuy}>
              {t("buy")}
            </button>
            <button className="primary sell" onClick={onSell}>
              {t("sell")}
            </button>
          </div>
        </div>
      </div>
    </motion.section>
  )
}
