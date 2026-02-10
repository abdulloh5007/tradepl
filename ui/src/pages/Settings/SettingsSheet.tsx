import { X, Moon, Sun, Globe, LogOut } from "lucide-react"
import type { Lang, Theme } from "../../types"
import { t } from "../../utils/i18n"
import "../../components/accounts/SharedAccountSheet.css"

interface SettingsSheetProps {
    open: boolean
    onClose: () => void
    lang: Lang
    setLang: (lang: Lang) => void
    theme: Theme
    setTheme: (theme: Theme) => void
    onLogout: () => void
}

export default function SettingsSheet({
    open,
    onClose,
    lang,
    setLang,
    theme,
    setTheme,
    onLogout
}: SettingsSheetProps) {
    if (!open) return null

    return (
        <div className="acm-overlay" style={{ zIndex: 200 }}>
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
                        <div className="acm-section-title" style={{ padding: '16px 0 8px', color: '#6b7280', fontSize: 13, fontWeight: 600 }}>
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
                                        border: '1px solid ' + (lang === l ? '#3b82f6' : 'rgba(255,255,255,0.1)'),
                                        background: lang === l ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                                        color: lang === l ? '#3b82f6' : '#9ca3af',
                                        fontWeight: 600,
                                        cursor: 'pointer'
                                    }}
                                >
                                    {l.toUpperCase()}
                                </button>
                            ))}
                        </div>

                        {/* Theme Section */}
                        <div className="acm-section-title" style={{ padding: '8px 0', color: '#6b7280', fontSize: 13, fontWeight: 600 }}>
                            {t("theme", lang)}
                        </div>
                        <div className="acm-segment" style={{ display: 'flex', gap: 8, padding: '0 0 16px' }}>
                            <button
                                onClick={() => setTheme("dark")}
                                style={{
                                    flex: 1,
                                    padding: '10px',
                                    borderRadius: 12,
                                    border: '1px solid ' + (theme === 'dark' ? '#3b82f6' : 'rgba(255,255,255,0.1)'),
                                    background: theme === 'dark' ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                                    color: theme === 'dark' ? '#3b82f6' : '#9ca3af',
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
                                    border: '1px solid ' + (theme === 'light' ? '#3b82f6' : 'rgba(255,255,255,0.1)'),
                                    background: theme === 'light' ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                                    color: theme === 'light' ? '#3b82f6' : '#9ca3af',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                    cursor: 'pointer'
                                }}
                            >
                                <Sun size={16} /> {t("light", lang)}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="acm-footer">
                    <button
                        className="acm-submit-btn"
                        onClick={onLogout}
                        style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)' }}
                    >
                        <LogOut size={18} style={{ marginRight: 8 }} />
                        {t("logout", lang)}
                    </button>
                </div>
            </div>
        </div>
    )
}
