import { X, Moon, Sun, LogOut, Trophy } from "lucide-react"
import type { Lang, Theme } from "../../types"
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
    onLogout,
    onOpenProfitStages
}: SettingsSheetProps) {
    const { shouldRender, isVisible } = useAnimatedPresence(open, 140)
    if (!shouldRender) return null

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
