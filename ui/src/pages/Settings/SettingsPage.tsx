import { ArrowLeft } from "lucide-react"
import type { Lang, NotificationSettings, Theme } from "../../types"
import { t } from "../../utils/i18n"
import "./SettingsPage.css"

interface SettingsPageProps {
    lang: Lang
    setLang: (lang: Lang) => void
    theme: Theme
    setTheme: (theme: Theme) => void
    notificationSettings: NotificationSettings
    setNotificationSettings: (settings: NotificationSettings) => void
    onBack: () => void
    onLogout: () => void
}

export default function SettingsPage({
    lang,
    setLang,
    theme,
    setTheme,
    notificationSettings,
    setNotificationSettings,
    onBack,
    onLogout,
}: SettingsPageProps) {
    const kinds = notificationSettings.kinds

    const toggleGlobal = () => {
        setNotificationSettings({
            ...notificationSettings,
            enabled: !notificationSettings.enabled,
        })
    }

    const toggleKind = (key: keyof NotificationSettings["kinds"]) => {
        setNotificationSettings({
            ...notificationSettings,
            kinds: {
                ...notificationSettings.kinds,
                [key]: !notificationSettings.kinds[key],
            }
        })
    }

    return (
        <div className="settings-page">
            <div className="settings-header">
                <button type="button" className="settings-back-btn" onClick={onBack} aria-label={t("profitStages.backToProfile", lang)}>
                    <ArrowLeft size={17} />
                </button>
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

            <section className="settings-card">
                <div className="settings-row settings-row-stack">
                    <div>
                        <div className="settings-title">{t("settings.notifications.title", lang)}</div>
                        <div className="settings-subtitle">{t("settings.notifications.masterHint", lang)}</div>
                    </div>
                    <button
                        type="button"
                        className={`settings-switch-btn ${notificationSettings.enabled ? "active" : ""}`}
                        onClick={toggleGlobal}
                    >
                        {notificationSettings.enabled ? t("settings.notifications.state.on", lang) : t("settings.notifications.state.off", lang)}
                    </button>
                </div>
                <div className="settings-options-list">
                    <button
                        type="button"
                        className={`settings-option-btn ${notificationSettings.enabled ? "" : "disabled"}`}
                        onClick={() => notificationSettings.enabled && toggleKind("system")}
                    >
                        <span>{t("settings.notifications.kind.system", lang)}</span>
                        <span>{kinds.system ? t("settings.notifications.state.on", lang) : t("settings.notifications.state.off", lang)}</span>
                    </button>
                    <button
                        type="button"
                        className={`settings-option-btn ${notificationSettings.enabled ? "" : "disabled"}`}
                        onClick={() => notificationSettings.enabled && toggleKind("bonus")}
                    >
                        <span>{t("settings.notifications.kind.bonus", lang)}</span>
                        <span>{kinds.bonus ? t("settings.notifications.state.on", lang) : t("settings.notifications.state.off", lang)}</span>
                    </button>
                    <button
                        type="button"
                        className={`settings-option-btn ${notificationSettings.enabled ? "" : "disabled"}`}
                        onClick={() => notificationSettings.enabled && toggleKind("deposit")}
                    >
                        <span>{t("settings.notifications.kind.deposit", lang)}</span>
                        <span>{kinds.deposit ? t("settings.notifications.state.on", lang) : t("settings.notifications.state.off", lang)}</span>
                    </button>
                    <button
                        type="button"
                        className={`settings-option-btn ${notificationSettings.enabled ? "" : "disabled"}`}
                        onClick={() => notificationSettings.enabled && toggleKind("news")}
                    >
                        <span>{t("settings.notifications.kind.news", lang)}</span>
                        <span>{kinds.news ? t("settings.notifications.state.on", lang) : t("settings.notifications.state.off", lang)}</span>
                    </button>
                </div>
            </section>

            <section className="settings-card danger">
                <div className="settings-row settings-row-stack">
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
