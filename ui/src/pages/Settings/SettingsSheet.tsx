import { X, Moon, Sun, LogOut, Trophy } from "lucide-react"
import type { Lang, NotificationSettings, Theme } from "../../types"
import { t } from "../../utils/i18n"
import { useAnimatedPresence } from "../../hooks/useAnimatedPresence"
import "../../components/accounts/SharedAccountSheet.css"

interface SettingsSheetProps {
    open: boolean
    onClose: () => void
    lang: Lang
    setLang: (lang: Lang) => void
    theme: Theme
    setTheme: (theme: Theme) => void
    notificationSettings: NotificationSettings
    setNotificationSettings: (settings: NotificationSettings) => void
    onLogout: () => void
    onOpenProfitStages?: () => void
}

export default function SettingsSheet({
    open,
    onClose,
    lang,
    setLang,
    theme,
    setTheme,
    notificationSettings,
    setNotificationSettings,
    onLogout,
    onOpenProfitStages
}: SettingsSheetProps) {
    const { shouldRender, isVisible } = useAnimatedPresence(open, 140)
    if (!shouldRender) return null

    const kinds = notificationSettings.kinds
    const toggleGlobal = () => {
        setNotificationSettings({ ...notificationSettings, enabled: !notificationSettings.enabled })
    }
    const toggleKind = (key: keyof NotificationSettings["kinds"]) => {
        setNotificationSettings({
            ...notificationSettings,
            kinds: {
                ...notificationSettings.kinds,
                [key]: !notificationSettings.kinds[key]
            }
        })
    }

    return (
        <div className={`acm-overlay ${isVisible ? "is-open" : "is-closing"}`} style={{ zIndex: 200 }}>
            <div className="acm-backdrop" onClick={onClose} />
            <div className="acm-sheet">
                <div className="acm-header">
                    <button onClick={onClose} className="acm-close-btn">
                        <X size={24} />
                    </button>
                    <h2 className="acm-title">{t("settings", lang)}</h2>
                    <div className="acm-spacer" />
                </div>

                <div className="acm-content">
                    <div className="acm-list">
                        {/* Language Section */}
                        <div className="acm-section-title" style={{ padding: '16px 0 8px', color: 'var(--muted)', fontSize: 13, fontWeight: 600 }}>
                            {t("language", lang)}
                        </div>
                        <div className="acm-segment" style={{ display: 'flex', gap: 8, padding: '0 0 16px' }}>
                            {['en', 'uz', 'ru'].map((l) => (
                                <button
                                    key={l}
                                    onClick={() => setLang(l as Lang)}
                                    className={`acm-segment-btn ${lang === l ? 'active' : ''}`}
                                    style={{
                                        flex: 1,
                                        padding: '10px',
                                        borderRadius: 12,
                                        border: `1px solid ${lang === l ? "var(--accent-2)" : "var(--border)"}`,
                                        background: lang === l ? 'color-mix(in srgb, var(--accent-2) 12%, transparent)' : 'transparent',
                                        color: lang === l ? 'var(--accent-2)' : 'var(--muted)',
                                        fontWeight: 600,
                                        cursor: 'pointer'
                                    }}
                                >
                                    {l.toUpperCase()}
                                </button>
                            ))}
                        </div>

                        {/* Theme Section */}
                        <div className="acm-section-title" style={{ padding: '8px 0', color: 'var(--muted)', fontSize: 13, fontWeight: 600 }}>
                            {t("theme", lang)}
                        </div>
                        <div className="acm-segment" style={{ display: 'flex', gap: 8, padding: '0 0 16px' }}>
                            <button
                                onClick={() => setTheme("dark")}
                                style={{
                                    flex: 1,
                                    padding: '10px',
                                    borderRadius: 12,
                                    border: `1px solid ${theme === "dark" ? "var(--accent-2)" : "var(--border)"}`,
                                    background: theme === 'dark' ? 'color-mix(in srgb, var(--accent-2) 12%, transparent)' : 'transparent',
                                    color: theme === 'dark' ? 'var(--accent-2)' : 'var(--muted)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                    cursor: 'pointer'
                                }}
                            >
                                <Moon size={16} /> {t("dark", lang)}
                            </button>
                            <button
                                onClick={() => setTheme("light")}
                                style={{
                                    flex: 1,
                                    padding: '10px',
                                    borderRadius: 12,
                                    border: `1px solid ${theme === "light" ? "var(--accent-2)" : "var(--border)"}`,
                                    background: theme === 'light' ? 'color-mix(in srgb, var(--accent-2) 12%, transparent)' : 'transparent',
                                    color: theme === 'light' ? 'var(--accent-2)' : 'var(--muted)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                    cursor: 'pointer'
                                }}
                            >
                                <Sun size={16} /> {t("light", lang)}
                            </button>
                        </div>

                        <div className="acm-section-title" style={{ padding: '8px 0', color: 'var(--muted)', fontSize: 13, fontWeight: 600 }}>
                            {t("settings.notifications.title", lang)}
                        </div>
                        <div className="acm-list-item" style={{ cursor: "default", marginBottom: 8 }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                <span style={{ fontSize: 13, fontWeight: 600 }}>{t("settings.notifications.master", lang)}</span>
                                <span style={{ fontSize: 11, color: "var(--muted)" }}>{t("settings.notifications.masterHint", lang)}</span>
                            </div>
                            <button
                                type="button"
                                onClick={toggleGlobal}
                                style={{
                                    border: `1px solid ${notificationSettings.enabled ? "color-mix(in srgb, var(--accent-2) 55%, transparent)" : "var(--border)"}`,
                                    background: notificationSettings.enabled
                                        ? "color-mix(in srgb, var(--accent-2) 15%, transparent)"
                                        : "transparent",
                                    color: notificationSettings.enabled ? "var(--accent-2)" : "var(--muted)",
                                    borderRadius: 999,
                                    padding: "6px 10px",
                                    fontSize: 11,
                                    fontWeight: 600,
                                    cursor: "pointer"
                                }}
                            >
                                {notificationSettings.enabled ? t("settings.notifications.state.on", lang) : t("settings.notifications.state.off", lang)}
                            </button>
                        </div>

                        <div className="acm-list-item" style={{ cursor: notificationSettings.enabled ? "pointer" : "not-allowed", opacity: notificationSettings.enabled ? 1 : 0.55 }} onClick={() => notificationSettings.enabled && toggleKind("system")}>
                            <span>{t("settings.notifications.kind.system", lang)}</span>
                            <span>{kinds.system ? t("settings.notifications.state.on", lang) : t("settings.notifications.state.off", lang)}</span>
                        </div>
                        <div className="acm-list-item" style={{ cursor: notificationSettings.enabled ? "pointer" : "not-allowed", opacity: notificationSettings.enabled ? 1 : 0.55 }} onClick={() => notificationSettings.enabled && toggleKind("bonus")}>
                            <span>{t("settings.notifications.kind.bonus", lang)}</span>
                            <span>{kinds.bonus ? t("settings.notifications.state.on", lang) : t("settings.notifications.state.off", lang)}</span>
                        </div>
                        <div className="acm-list-item" style={{ cursor: notificationSettings.enabled ? "pointer" : "not-allowed", opacity: notificationSettings.enabled ? 1 : 0.55 }} onClick={() => notificationSettings.enabled && toggleKind("deposit")}>
                            <span>{t("settings.notifications.kind.deposit", lang)}</span>
                            <span>{kinds.deposit ? t("settings.notifications.state.on", lang) : t("settings.notifications.state.off", lang)}</span>
                        </div>
                        <div className="acm-list-item" style={{ cursor: notificationSettings.enabled ? "pointer" : "not-allowed", opacity: notificationSettings.enabled ? 1 : 0.55 }} onClick={() => notificationSettings.enabled && toggleKind("news")}>
                            <span>{t("settings.notifications.kind.news", lang)}</span>
                            <span>{kinds.news ? t("settings.notifications.state.on", lang) : t("settings.notifications.state.off", lang)}</span>
                        </div>

                        {onOpenProfitStages ? (
                            <>
                                <div className="acm-section-title" style={{ padding: '8px 0', color: 'var(--muted)', fontSize: 13, fontWeight: 600 }}>
                                    {t("profile.rewards", lang)}
                                </div>
                                <button
                                    type="button"
                                    onClick={onOpenProfitStages}
                                    className="acm-list-item"
                                    style={{
                                        marginBottom: 16,
                                        background: 'color-mix(in srgb, var(--accent-2) 9%, transparent)',
                                        borderColor: 'color-mix(in srgb, var(--accent-2) 28%, transparent)',
                                        color: 'var(--text)',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                        <Trophy size={14} />
                                        {t("profile.profitStages", lang)}
                                    </span>
                                    <span>{t("profile.open", lang)}</span>
                                </button>
                            </>
                        ) : null}
                    </div>
                </div>

                <div className="acm-footer">
                    <button
                        className="acm-submit-btn"
                        onClick={onLogout}
                        style={{ background: 'color-mix(in srgb, var(--status-danger) 12%, transparent)', color: 'var(--status-danger)', border: '1px solid color-mix(in srgb, var(--status-danger) 30%, transparent)' }}
                    >
                        <LogOut size={18} style={{ marginRight: 8 }} />
                        {t("logout", lang)}
                    </button>
                </div>
            </div>
        </div>
    )
}
