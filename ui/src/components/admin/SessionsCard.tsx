import { Activity, Building2, Zap, CheckCircle } from "lucide-react"
import { SessionConfig } from "./types"
import Skeleton from "../Skeleton"
import type { Lang } from "../../types"
import { t } from "../../utils/i18n"

interface SessionsCardProps {
    lang: Lang
    sessions: SessionConfig[]
    activeSession: string
    mode: string
    loading: boolean
    initialLoad: boolean
    canAccess: boolean
    onSwitchSession: (id: string) => void
    onToggleMode: () => void
}

export default function SessionsCard({
    lang,
    sessions, activeSession, mode, loading, initialLoad, canAccess,
    onSwitchSession, onToggleMode
}: SessionsCardProps) {

    if (!canAccess) return null

    const sessionIcons: Record<string, any> = { london: Building2, newyork: Zap }
    const sessionSchedule: Record<string, string> = { london: "22:00 - 13:00 UTC", newyork: "13:00 - 22:00 UTC" }
    const sessionTitleByID: Record<string, string> = {
        london: t("manage.sessions.session.london", lang),
        newyork: t("manage.sessions.session.newyork", lang),
    }

    return (
        <div className="admin-card">
            <div className="admin-card-header">
                <Activity size={20} />
                <h2>{t("manage.sessions.title", lang)}</h2>
                <div className="mode-toggle">
                    {initialLoad ? <Skeleton width={120} height={24} radius={12} /> : (
                        <>
                            <span className={mode === "manual" ? "active" : ""}>{t("manage.common.manual", lang)}</span>
                            <button className={`toggle-switch ${mode === "auto" ? "checked" : ""}`} onClick={onToggleMode} disabled={loading}>
                                <span className="toggle-thumb" />
                            </button>
                            <span className={mode === "auto" ? "active" : ""}>{t("manage.common.auto", lang)}</span>
                        </>
                    )}
                </div>
            </div>
            <div className="sessions-grid">
                {initialLoad ? Array(2).fill(0).map((_, i) => (
                    <div key={i} className="session-card" style={{ pointerEvents: "none", opacity: 0.7 }}>
                        <Skeleton width={24} height={24} radius="50%" />
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                            <Skeleton width="60%" height={16} />
                            <Skeleton width="40%" height={12} />
                        </div>
                    </div>
                )) : [...sessions].sort((a, b) => {
                    const order: Record<string, number> = { london: 0, newyork: 1 }
                    return (order[a.id] ?? 9) - (order[b.id] ?? 9)
                }).map(s => {
                    const Icon = sessionIcons[s.id] || Building2
                    const isActive = activeSession === s.id
                    return (
                        <button key={s.id} className={`session-card ${isActive ? "active" : ""} ${mode === "auto" ? "auto-disabled" : ""}`}
                            onClick={() => onSwitchSession(s.id)} disabled={loading || mode === "auto"}
                            style={{ opacity: mode === "auto" && !isActive ? 0.6 : 1 }}>
                            <Icon size={24} />
                            <span className="session-name">{sessionTitleByID[s.id] || s.name}</span>
                            {mode === "auto"
                                ? <span className="session-rate" style={{ fontSize: 11 }}>{sessionSchedule[s.id] || t("manage.sessions.schedule.allDay", lang)}</span>
                                : <span className="session-rate">{t("manage.sessions.updateRateMs", lang).replace("{ms}", String(s.update_rate_ms))}</span>}
                            {isActive && <CheckCircle size={16} className="session-check" />}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
