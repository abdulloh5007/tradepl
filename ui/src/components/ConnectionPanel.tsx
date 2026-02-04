import { motion } from "framer-motion"
import { Globe } from "lucide-react"
import { PanelMotion } from "../types/ui"

type Props = {
  t: (key: string) => string
  panelMotion: PanelMotion
  baseUrl: string
  token: string
  wsStatus: string
  onBaseUrlChange: (value: string) => void
  onTokenChange: (value: string) => void
  onBaseUrlBlur: () => void
  onUseToken: () => void
}

export default function ConnectionPanel({
  t,
  panelMotion,
  baseUrl,
  token,
  wsStatus,
  onBaseUrlChange,
  onTokenChange,
  onBaseUrlBlur,
  onUseToken
}: Props) {
  return (
    <motion.section className="panel" {...panelMotion}>
      <div className="panel-head">
        <div className="panel-title">
          <Globe size={16} />
          {t("connection")}
        </div>
      </div>
      <div className="grid">
        <label className="field">
          <span>{t("baseUrl")}</span>
          <input value={baseUrl} onChange={e => onBaseUrlChange(e.target.value)} onBlur={onBaseUrlBlur} placeholder={t("baseUrlPh")} />
          <span className="hint">{t("baseUrlHint")}</span>
        </label>
        <label className="field">
          <span>{t("token")}</span>
          <input value={token} onChange={e => onTokenChange(e.target.value)} placeholder={t("tokenPh")} />
        </label>
        <div className="row">
          <button className="ghost" onClick={onUseToken}>
            {t("useToken")}
          </button>
          <span className="tag">{wsStatus}</span>
        </div>
      </div>
    </motion.section>
  )
}
