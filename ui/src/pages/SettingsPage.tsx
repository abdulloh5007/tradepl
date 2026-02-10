import type { Lang, Theme } from "../types"
import { t } from "../utils/i18n"

interface SettingsPageProps {
    lang: Lang
    setLang: (lang: Lang) => void
    theme: Theme
    setTheme: (theme: Theme) => void
    onLogout: () => void
}

export default function SettingsPage({ lang, setLang, theme, setTheme, onLogout }: SettingsPageProps) {
    return (
        <div className="settings-page">
            <div className="settings-header">
                <h2>{t("settings", lang)}</h2>
                <p>{t("settingsHint", lang)}</p>
            </div>

            <section className="settings-card">
                <div className="settings-row">
                    <div>
                        <div className="settings-title">{t("language", lang)}</div>
                        <div className="settings-subtitle">{t("languageHint", lang)}</div>
                    </div>
                    <div className="settings-segment">
                        <button
                            type="button"
                            className={lang === "en" ? "active" : ""}
                            onClick={() => setLang("en")}
                        >
                            EN
                        </button>
                        <button
                            type="button"
                            className={lang === "uz" ? "active" : ""}
                            onClick={() => setLang("uz")}
                        >
                            UZ
                        </button>
                        <button
                            type="button"
                            className={lang === "ru" ? "active" : ""}
                            onClick={() => setLang("ru")}
                        >
                            RU
                        </button>
                    </div>
                </div>
            </section>

            <section className="settings-card">
                <div className="settings-row">
                    <div>
                        <div className="settings-title">{t("theme", lang)}</div>
                        <div className="settings-subtitle">{t("themeHint", lang)}</div>
                    </div>
                    <div className="settings-segment">
                        <button
                            type="button"
                            className={theme === "light" ? "active" : ""}
                            onClick={() => setTheme("light")}
                        >
                            {t("light", lang)}
                        </button>
                        <button
                            type="button"
                            className={theme === "dark" ? "active" : ""}
                            onClick={() => setTheme("dark")}
                        >
                            {t("dark", lang)}
                        </button>
                    </div>
                </div>
            </section>

            <section className="settings-card danger">
                <div className="settings-row">
                    <div>
                        <div className="settings-title">{t("logout", lang)}</div>
                        <div className="settings-subtitle">{t("logoutHint", lang)}</div>
                    </div>
                    <button type="button" className="settings-logout-btn" onClick={onLogout}>
                        {t("logout", lang)}
                    </button>
                </div>
            </section>
        </div>
    )
}
