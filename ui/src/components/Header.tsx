import { Moon, Sun } from "lucide-react"
import * as Switch from "@radix-ui/react-switch"
import type { Theme, Lang } from "../types"
import { t } from "../utils/i18n"
import SmartDropdown from "./ui/SmartDropdown"

interface HeaderProps {
    theme: Theme
    setTheme: (t: Theme) => void
    lang: Lang
    setLang: (l: Lang) => void
    token: string
    onLogout: () => void
}

export default function Header({ theme, setTheme, lang, setLang, token, onLogout }: HeaderProps) {
    const langOptions = [
        { value: "en", label: "EN" },
        { value: "uz", label: "UZ" },
        { value: "ru", label: "RU" }
    ]

    return (
        <header style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 24px",
            borderBottom: "1px solid var(--border-subtle)",
            background: "var(--panel)"
        }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>LV Trade</h1>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                {/* Language Selector */}
                <SmartDropdown
                    value={lang}
                    options={langOptions}
                    onChange={v => setLang(String(v) as Lang)}
                    ariaLabel="Language"
                    className="header-lang-dropdown"
                />

                {/* Theme Toggle */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Sun size={14} style={{ color: theme === "light" ? "var(--accent)" : "var(--text-muted)", transition: "color 0.2s" }} />
                    <Switch.Root
                        checked={theme === "dark"}
                        onCheckedChange={c => setTheme(c ? "dark" : "light")}
                        style={{
                            width: 42,
                            height: 24,
                            background: theme === "dark" ? "#22c55e" : "#cbd5e1",
                            borderRadius: 9999,
                            border: "none",
                            cursor: "pointer",
                            position: "relative",
                            padding: 2,
                            transition: "background-color 0.2s ease-in-out",
                            WebkitTapHighlightColor: "transparent"
                        }}
                    >
                        <Switch.Thumb style={{
                            display: "block",
                            width: 20,
                            height: 20,
                            background: "white",
                            borderRadius: "50%",
                            boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                            transition: "transform 0.2s cubic-bezier(0.4, 0.0, 0.2, 1)",
                            transform: theme === "dark" ? "translateX(18px)" : "translateX(0)",
                            willChange: "transform"
                        }} />
                    </Switch.Root>
                    <Moon size={14} style={{ color: theme === "dark" ? "var(--accent)" : "var(--text-muted)", transition: "color 0.2s" }} />
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
