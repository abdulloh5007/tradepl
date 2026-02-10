import { BarChart2, History, List, Settings2, Wallet } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { Lang, View } from "../types"
import { t } from "../utils/i18n"
import "./BottomNav.css"

interface BottomNavProps {
    view: View
    setView: (view: View) => void
    lang: Lang
}

const navTabs: Array<{ key: View; labelKey: string; icon: LucideIcon }> = [
    { key: "accounts", labelKey: "accounts", icon: Wallet },
    { key: "chart", labelKey: "chart", icon: BarChart2 },
    { key: "positions", labelKey: "positions", icon: List },
    { key: "history", labelKey: "history", icon: History },
    { key: "settings", labelKey: "settings", icon: Settings2 }
]

export default function BottomNav({ view, setView, lang }: BottomNavProps) {
    return (
        <div className="bottom-nav-wrap">
            <nav className="bottom-nav" aria-label="Main navigation">
                {navTabs.map(tab => {
                    const Icon = tab.icon
                    const active = view === tab.key
                    return (
                        <button
                            key={tab.key}
                            type="button"
                            className={`bottom-nav-btn ${active ? "active" : ""}`}
                            onClick={() => setView(tab.key)}
                            aria-label={t(tab.labelKey, lang)}
                        >
                            <Icon size={18} />
                            <span className="bottom-nav-btn-label">{t(tab.labelKey, lang)}</span>
                        </button>
                    )
                })}
            </nav>
        </div>
    )
}
