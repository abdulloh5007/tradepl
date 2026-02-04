import { Moon, Sun } from "lucide-react"
import * as Switch from "@radix-ui/react-switch"
import type { Theme, Lang } from "../types"
import { t } from "../utils/i18n"

interface HeaderProps {
    theme: Theme
    setTheme: (t: Theme) => void
    lang: Lang
    setLang: (l: Lang) => void
    token: string
    onLogout: () => void
}

export default function Header({ theme, setTheme, lang, setLang, token, onLogout }: HeaderProps) {
    return (
        <header style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 24px",
            borderBottom: "1px solid var(--border-subtle)",
            background: "var(--card-bg)"
        }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>LV Trade</h1>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                {/* Language Selector */}
                <select
                    value={lang}
                    onChange={e => setLang(e.target.value as Lang)}
                    style={{
                        padding: "6px 10px",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: 4,
                        background: "var(--input-bg)",
                        color: "var(--text-base)",
                        fontSize: 12
                    }}
                >
                    <option value="en">EN</option>
                    <option value="uz">UZ</option>
                    <option value="ru">RU</option>
                </select>

                {/* Theme Toggle */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Sun size={14} />
                    <Switch.Root
                        checked={theme === "dark"}
                        onCheckedChange={c => setTheme(c ? "dark" : "light")}
                        style={{
                            width: 36,
                            height: 20,
                            background: theme === "dark" ? "#16a34a" : "#d1d5db",
                            borderRadius: 10,
                            border: "none",
                            cursor: "pointer",
                            position: "relative"
                        }}
                    >
                        <Switch.Thumb style={{
                            display: "block",
                            width: 16,
                            height: 16,
                            background: "white",
                            borderRadius: "50%",
                            transition: "transform 100ms",
                            transform: theme === "dark" ? "translateX(18px)" : "translateX(2px)"
                        }} />
                    </Switch.Root>
                    <Moon size={14} />
                </div>

                {/* Logout */}
                {token && (
                    <button
                        onClick={onLogout}
                        style={{
                            padding: "6px 12px",
                            border: "1px solid var(--border-subtle)",
                            borderRadius: 4,
                            background: "transparent",
                            color: "var(--text-base)",
                            fontSize: 12,
                            cursor: "pointer"
                        }}
                    >
                        {t("logout", lang)}
                    </button>
                )}
            </div>
        </header>
    )
}
