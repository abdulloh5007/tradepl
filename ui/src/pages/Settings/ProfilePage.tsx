import { useMemo, useState } from "react"
import { Settings2, User } from "lucide-react"
import type { UserProfile } from "../../api"
import type { Lang, Theme } from "../../types"
import SettingsSheet from "./SettingsSheet"

interface ProfilePageProps {
    lang: Lang
    setLang: (lang: Lang) => void
    theme: Theme
    setTheme: (theme: Theme) => void
    onLogout: () => void
    profile: UserProfile | null
}

export default function ProfilePage({ lang, setLang, theme, setTheme, onLogout, profile }: ProfilePageProps) {
    const [showSettings, setShowSettings] = useState(false)

    const displayName = useMemo(() => {
        const preferred = (profile?.display_name || "").trim()
        if (preferred) return preferred
        const fromEmail = (profile?.email || "").trim()
        if (fromEmail) return fromEmail
        return "Trader"
    }, [profile])

    const avatarUrl = (profile?.avatar_url || "").trim()
    const initial = displayName.charAt(0).toUpperCase()

    return (
        <div className="profile-page" style={{ padding: "0 0 100px", display: "flex", flexDirection: "column", minHeight: "100%" }}>
            <div style={{ padding: "20px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Profile</h2>
                <button
                    onClick={() => setShowSettings(true)}
                    style={{
                        width: 40,
                        height: 40,
                        borderRadius: "50%",
                        background: "rgba(255,255,255,0.05)",
                        border: "none",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        cursor: "pointer"
                    }}
                    aria-label="Open settings"
                    type="button"
                >
                    <Settings2 size={20} />
                </button>
            </div>

            <div style={{ padding: "0 16px", marginTop: 10 }}>
                <div
                    style={{
                        background: "rgba(255,255,255,0.03)",
                        borderRadius: 24,
                        padding: 28,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        border: "1px solid rgba(255,255,255,0.05)"
                    }}
                >
                    {avatarUrl ? (
                        <img
                            src={avatarUrl}
                            alt={displayName}
                            style={{ width: 88, height: 88, borderRadius: "50%", objectFit: "cover", marginBottom: 14 }}
                        />
                    ) : (
                        <div
                            style={{
                                width: 88,
                                height: 88,
                                borderRadius: "50%",
                                marginBottom: 14,
                                background: "linear-gradient(135deg, #1f2937 0%, #111827 100%)",
                                color: "#f3f4f6",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 30,
                                fontWeight: 700
                            }}
                        >
                            {initial || <User size={34} />}
                        </div>
                    )}
                    <h3 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{displayName}</h3>
                </div>
            </div>

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
