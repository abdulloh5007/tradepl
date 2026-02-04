import type { View, Lang } from "../types"
import { t } from "../utils/i18n"

interface SidebarProps {
    view: View
    setView: (v: View) => void
    lang: Lang
}

export default function Sidebar({ view, setView, lang }: SidebarProps) {
    const tabs: { key: View; label: string }[] = [
        { key: "chart", label: t("chart", lang) },
        { key: "api", label: t("api", lang) },
        { key: "faucet", label: t("faucet", lang) }
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
                        fontSize: 10,
                        fontWeight: 500,
                        cursor: "pointer",
                        transition: "all 0.15s"
                    }}
                >
                    {tab.label}
                </button>
            ))}
        </aside>
    )
}
