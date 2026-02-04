import { motion } from "framer-motion"
import SwaggerUI from "swagger-ui-react"
import "swagger-ui-react/swagger-ui.css"
import * as Tabs from "@radix-ui/react-tabs"
import { Code2, Globe, Terminal } from "lucide-react"
import { PanelMotion } from "../types/ui"

type Props = {
  t: (key: string) => string
  panelMotion: PanelMotion
  sdkSnippets: { curl: string; js: string; go: string }
}

export default function ApiView({ t, panelMotion, sdkSnippets }: Props) {
  return (
    <div id="api">
      <motion.section className="panel" {...panelMotion}>
        <div className="panel-head">
          <div className="panel-title">
            <Globe size={16} />
            {t("apiDocs")}
          </div>
        </div>
        <div className="swagger-shell">
          <div className="swagger">
            <SwaggerUI url="/openapi.yaml" />
          </div>
        </div>
      </motion.section>
      <motion.section className="panel" {...panelMotion}>
        <div className="panel-head">
          <div className="panel-title">
            <Code2 size={16} />
            SDK
          </div>
        </div>
        <Tabs.Root defaultValue="curl" className="tabs">
          <Tabs.List className="tablist">
            <Tabs.Trigger value="curl" className="tab">
              <Terminal size={14} />
              curl
            </Tabs.Trigger>
            <Tabs.Trigger value="js" className="tab">
              <Code2 size={14} />
              JavaScript
            </Tabs.Trigger>
            <Tabs.Trigger value="go" className="tab">
              <Code2 size={14} />
              Go
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="curl">
            <pre className="output code">{sdkSnippets.curl}</pre>
          </Tabs.Content>
          <Tabs.Content value="js">
            <pre className="output code">{sdkSnippets.js}</pre>
          </Tabs.Content>
          <Tabs.Content value="go">
            <pre className="output code">{sdkSnippets.go}</pre>
          </Tabs.Content>
        </Tabs.Root>
      </motion.section>
    </div>
  )
}
