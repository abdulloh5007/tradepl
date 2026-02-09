import { BarChart2, List, Key, Droplet, FolderKanban, History } from "lucide-react"
import type { View, Lang } from "../types"
import { t } from "../utils/i18n"

interface SidebarProps {
    view: View
    setView: (v: View) => void
    lang: Lang
}

export default function Sidebar({ view, setView, lang }: SidebarProps) {
    const tabs = [
        { key: "chart" as const, label: t("chart", lang), icon: BarChart2 },
        { key: "positions" as const, label: t("positions", lang), icon: List },
        { key: "history" as const, label: t("history", lang), icon: History },
        { key: "accounts" as const, label: t("accounts", lang), icon: FolderKanban },
        { key: "api" as const, label: t("api", lang), icon: Key },
        { key: "faucet" as const, label: t("faucet", lang), icon: Droplet }
    ]

    return (
        <aside style={{
            width: 60,
            background: "var(--card-bg)",
            borderRight: "1px solid var(--border-subtle)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            paddingTop: 16,
            gap: 8
        }}>
            {tabs.map(tab => (
                <button
                    key={tab.key}
                    onClick={() => setView(tab.key)}
                    title={tab.label}
                    style={{
                        width: 48,
                        height: 48,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        border: "none",
                        borderRadius: 8,
                        background: view === tab.key ? "var(--accent-bg)" : "transparent",
                        color: view === tab.key ? "var(--accent-text)" : "var(--text-muted)",
                        cursor: "pointer",
                        transition: "all 0.15s"
                    }}
                >
                    <tab.icon size={20} strokeWidth={2} />
                </button>
            ))}
        </aside>
    )
}
