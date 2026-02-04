import { motion } from "framer-motion"
import * as Tooltip from "@radix-ui/react-tooltip"
import { Cable, Database, RefreshCw, Settings } from "lucide-react"
import { PanelMotion } from "../types/ui"

type Props = {
  t: (key: string) => string
  panelMotion: PanelMotion
  onConnect: () => void
  onDisconnect: () => void
  onClear: () => void
  wsMessages: string[]
  wsStatus: string
  baseUrl: string
}

export default function RealtimePanel({
  t,
  panelMotion,
  onConnect,
  onDisconnect,
  onClear,
  wsMessages,
  wsStatus,
  baseUrl
}: Props) {
  return (
    <motion.section className="panel" {...panelMotion}>
      <div className="panel-head">
        <div className="panel-title">
          <Cable size={16} />
          {t("realtime")}
        </div>
      </div>
      <div className="grid two">
        <div className="card">
          <div className="card-title">
            <Database size={16} />
            WebSocket
          </div>
          <div className="row">
            <button className="primary" onClick={onConnect}>
              {t("connect")}
            </button>
            <button className="ghost" onClick={onDisconnect}>
              {t("disconnect")}
            </button>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button className="ghost" type="button" onClick={onClear}>
                  <RefreshCw size={16} />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content className="tooltip" side="bottom">
                  Clear
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </div>
          <pre className="output">{wsMessages.join("\n")}</pre>
        </div>
        <div className="card">
          <div className="card-title">
            <Settings size={16} />
            Status
          </div>
          <div className="tag">{wsStatus}</div>
          <div className="tag">{baseUrl || "base url"}</div>
        </div>
      </div>
    </motion.section>
  )
}
