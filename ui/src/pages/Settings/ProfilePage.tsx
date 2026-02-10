import { useState } from "react"
import { User, Settings2, ShieldCheck, ChevronRight, CreditCard, Download } from "lucide-react"
import type { Lang, Theme } from "../../types"
import { t } from "../../utils/i18n"
import SettingsSheet from "./SettingsSheet"
import "./SettingsPage.css" // Reusing styles for now or creating new ones? Let's use inline or reuse classnames.

interface ProfilePageProps {
    lang: Lang
    setLang: (lang: Lang) => void
    theme: Theme
    setTheme: (theme: Theme) => void
    onLogout: () => void
    accountId: string
}

export default function ProfilePage({ lang, setLang, theme, setTheme, onLogout, accountId }: ProfilePageProps) {
    const [showSettings, setShowSettings] = useState(false)

    return (
        <div className="profile-page" style={{ padding: '0 0 100px', display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Header */}
            <div style={{ padding: '20px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Profile</h2>
                <button
                    onClick={() => setShowSettings(true)}
                    style={{
                        width: 40, height: 40, borderRadius: '50%',
                        background: 'rgba(255,255,255,0.05)', border: 'none',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', cursor: 'pointer'
                    }}
                >
                    <Settings2 size={20} />
                </button>
            </div>

            {/* User Card */}
            <div style={{ padding: '0 16px 24px' }}>
                <div style={{
                    background: 'rgba(255,255,255,0.03)',
                    borderRadius: 24,
                    padding: 24,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    border: '1px solid rgba(255,255,255,0.05)'
                }}>
                    <div style={{
                        width: 80, height: 80, borderRadius: '50%',
                        background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        marginBottom: 16,
                        boxShadow: '0 8px 32px rgba(59, 130, 246, 0.3)'
                    }}>
                        <User size={40} color="#fff" />
                    </div>
                    <h3 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 600 }}>Guest User</h3>
                    <p style={{ margin: 0, color: '#9ca3af', fontSize: 14 }}>ID: {accountId}</p>

                    <div style={{ marginTop: 20, display: 'flex', gap: 12 }}>
                        <div style={{
                            padding: '6px 12px', borderRadius: 20, background: 'rgba(16, 185, 129, 0.1)',
                            color: '#10b981', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4
                        }}>
                            <ShieldCheck size={14} /> Verified
                        </div>
                    </div>
                </div>
            </div>

            {/* Menu Items */}
            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[
                    { icon: CreditCard, label: "Payment Methods", desc: "Manage deposits & withdrawals" },
                    { icon: Download, label: "Trading Terminal", desc: "Download desktop or mobile app" },
                ].map((item, i) => (
                    <button key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 16,
                        padding: 16, borderRadius: 20,
                        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)',
                        color: 'inherit', textAlign: 'left', cursor: 'pointer'
                    }}>
                        <div style={{
                            width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,0.05)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff'
                        }}>
                            <item.icon size={20} />
                        </div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>{item.label}</div>
                            <div style={{ fontSize: 13, color: '#6b7280' }}>{item.desc}</div>
                        </div>
                        <ChevronRight size={18} color="#6b7280" />
                    </button>
                ))}
            </div>

            {/* Settings Sheet */}
            <SettingsSheet
                open={showSettings}
                onClose={() => setShowSettings(false)}
                lang={lang}
                setLang={setLang}
                theme={theme}
                setTheme={setTheme}
                onLogout={onLogout}
            />
        </div>
    )
}
