import { ArrowLeft } from "lucide-react"
import type { TelegramNotificationKinds } from "../../api"
import type { Lang, NotificationSettings, Theme } from "../../types"
import { t } from "../../utils/i18n"
import TelegramBackButton from "../../components/telegram/TelegramBackButton"
import { triggerTelegramHaptic } from "../../utils/telegramHaptics"
import "./SettingsPage.css"

interface SettingsPageProps {
    lang: Lang
    setLang: (lang: Lang) => void
    theme: Theme
    setTheme: (theme: Theme) => void
    notificationSettings: NotificationSettings
    setNotificationSettings: (settings: NotificationSettings) => void
    telegramBotSwitchVisible: boolean
    telegramBotNotificationsEnabled: boolean
    telegramBotNotificationKinds: TelegramNotificationKinds
    telegramBotNotificationsBusy: boolean
    telegramWriteAccess: boolean
    onToggleTelegramBotNotifications: (enabled: boolean) => Promise<void> | void
    onUpdateTelegramBotNotificationKinds: (kinds: TelegramNotificationKinds) => Promise<void> | void
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
    telegramBotSwitchVisible,
    telegramBotNotificationsEnabled,
    telegramBotNotificationKinds,
    telegramBotNotificationsBusy,
    telegramWriteAccess,
    onToggleTelegramBotNotifications,
    onUpdateTelegramBotNotificationKinds,
    onBack,
    onLogout,
}: SettingsPageProps) {
    const kinds = notificationSettings.kinds
    const hapticMode = notificationSettings.haptics

    const toggleGlobal = () => {
        triggerTelegramHaptic("toggle", hapticMode)
        setNotificationSettings({
            ...notificationSettings,
            enabled: !notificationSettings.enabled,
        })
    }

    const toggleKind = (key: keyof NotificationSettings["kinds"]) => {
        triggerTelegramHaptic("toggle", hapticMode)
        setNotificationSettings({
            ...notificationSettings,
            kinds: {
                ...notificationSettings.kinds,
                [key]: !notificationSettings.kinds[key],
            }
        })
    }

    const setHapticMode = (next: NotificationSettings["haptics"]) => {
        triggerTelegramHaptic("toggle", next)
        setNotificationSettings({
            ...notificationSettings,
            haptics: next,
        })
    }

    const handleToggleTelegram = async () => {
        if (telegramBotNotificationsBusy) return
        triggerTelegramHaptic("toggle", hapticMode)
        await onToggleTelegramBotNotifications(!telegramBotNotificationsEnabled)
    }

    const toggleTelegramBotKind = async (key: keyof TelegramNotificationKinds) => {
        if (telegramBotNotificationsBusy || !telegramBotNotificationsEnabled) return
        triggerTelegramHaptic("toggle", hapticMode)
        const nextKinds: TelegramNotificationKinds = {
            ...telegramBotNotificationKinds,
            [key]: !telegramBotNotificationKinds[key],
        }
        await onUpdateTelegramBotNotificationKinds(nextKinds)
    }

    return (
        <div className="settings-page">
            <div className="settings-header">
                <TelegramBackButton
                    onBack={onBack}
                    fallbackClassName="settings-back-btn"
                    fallbackAriaLabel={t("profitStages.backToProfile", lang)}
                    fallbackChildren={<ArrowLeft size={17} />}
                />
                <h2>{t("settings", lang)}</h2>
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
                            onClick={() => {
                                triggerTelegramHaptic("toggle", hapticMode)
                                setLang("en")
                            }}
                        >
                            EN
                        </button>
                        <button
                            type="button"
                            className={lang === "uz" ? "active" : ""}
                            onClick={() => {
                                triggerTelegramHaptic("toggle", hapticMode)
                                setLang("uz")
                            }}
                        >
                            UZ
                        </button>
                        <button
                            type="button"
                            className={lang === "ru" ? "active" : ""}
                            onClick={() => {
                                triggerTelegramHaptic("toggle", hapticMode)
                                setLang("ru")
                            }}
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
                            onClick={() => {
                                triggerTelegramHaptic("toggle", hapticMode)
                                setTheme("light")
                            }}
                        >
                            {t("light", lang)}
                        </button>
                        <button
                            type="button"
                            className={theme === "dark" ? "active" : ""}
                            onClick={() => {
                                triggerTelegramHaptic("toggle", hapticMode)
                                setTheme("dark")
                            }}
                        >
                            {t("dark", lang)}
                        </button>
                    </div>
                </div>
            </section>

            <section className="settings-card">
                <div className="settings-row">
                    <div>
                        <div className="settings-title">{t("settings.haptics.title", lang)}</div>
                    </div>
                    <div className="settings-segment">
                        <button
                            type="button"
                            className={hapticMode === "frequent" ? "active" : ""}
                            onClick={() => setHapticMode("frequent")}
                        >
                            {t("settings.haptics.frequent", lang)}
                        </button>
                        <button
                            type="button"
                            className={hapticMode === "normal" ? "active" : ""}
                            onClick={() => setHapticMode("normal")}
                        >
                            {t("settings.haptics.normal", lang)}
                        </button>
                        <button
                            type="button"
                            className={hapticMode === "off" ? "active" : ""}
                            onClick={() => setHapticMode("off")}
                        >
                            {t("settings.haptics.off", lang)}
                        </button>
                    </div>
                </div>
            </section>

            <section className="settings-card">
                <div className="settings-row">
                    <div>
                        <div className="settings-title">{t("settings.notifications.title", lang)}</div>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={notificationSettings.enabled}
                        className={`settings-ios-switch ${notificationSettings.enabled ? "checked" : ""}`}
                        onClick={toggleGlobal}
                    >
                        <span className="settings-ios-thumb" />
                    </button>
                </div>
                <div className="settings-options-list">
                    <div className={`settings-toggle-row ${notificationSettings.enabled ? "" : "disabled"}`}>
                        <span>{t("settings.notifications.kind.system", lang)}</span>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={kinds.system}
                            disabled={!notificationSettings.enabled}
                            className={`settings-ios-switch ${kinds.system ? "checked" : ""}`}
                            onClick={() => notificationSettings.enabled && toggleKind("system")}
                        >
                            <span className="settings-ios-thumb" />
                        </button>
                    </div>
                    <div className={`settings-toggle-row ${notificationSettings.enabled ? "" : "disabled"}`}>
                        <span>{t("settings.notifications.kind.bonus", lang)}</span>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={kinds.bonus}
                            disabled={!notificationSettings.enabled}
                            className={`settings-ios-switch ${kinds.bonus ? "checked" : ""}`}
                            onClick={() => notificationSettings.enabled && toggleKind("bonus")}
                        >
                            <span className="settings-ios-thumb" />
                        </button>
                    </div>
                    <div className={`settings-toggle-row ${notificationSettings.enabled ? "" : "disabled"}`}>
                        <span>{t("settings.notifications.kind.deposit", lang)}</span>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={kinds.deposit}
                            disabled={!notificationSettings.enabled}
                            className={`settings-ios-switch ${kinds.deposit ? "checked" : ""}`}
                            onClick={() => notificationSettings.enabled && toggleKind("deposit")}
                        >
                            <span className="settings-ios-thumb" />
                        </button>
                    </div>
                    <div className={`settings-toggle-row ${notificationSettings.enabled ? "" : "disabled"}`}>
                        <span>{t("settings.notifications.kind.news", lang)}</span>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={kinds.news}
                            disabled={!notificationSettings.enabled}
                            className={`settings-ios-switch ${kinds.news ? "checked" : ""}`}
                            onClick={() => notificationSettings.enabled && toggleKind("news")}
                        >
                            <span className="settings-ios-thumb" />
                        </button>
                    </div>
                    {telegramBotSwitchVisible ? (
                        <>
                            <div className="settings-toggle-row settings-toggle-row-stack">
                                <div className="settings-toggle-text">
                                    <span>{t("settings.notifications.telegramBot", lang)}</span>
                                    <small>
                                        {telegramWriteAccess
                                            ? t("settings.notifications.telegramBotHint", lang)
                                            : t("settings.notifications.telegramBotBlocked", lang)}
                                    </small>
                                </div>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={telegramBotNotificationsEnabled}
                                    disabled={telegramBotNotificationsBusy}
                                    className={`settings-ios-switch ${telegramBotNotificationsEnabled ? "checked" : ""}`}
                                    onClick={handleToggleTelegram}
                                >
                                    <span className="settings-ios-thumb" />
                                </button>
                            </div>
                            <div className={`settings-toggle-row ${telegramBotNotificationsEnabled ? "" : "disabled"}`}>
                                <span>{t("settings.notifications.kind.system", lang)}</span>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={telegramBotNotificationKinds.system}
                                    disabled={!telegramBotNotificationsEnabled || telegramBotNotificationsBusy}
                                    className={`settings-ios-switch ${telegramBotNotificationKinds.system ? "checked" : ""}`}
                                    onClick={() => { void toggleTelegramBotKind("system") }}
                                >
                                    <span className="settings-ios-thumb" />
                                </button>
                            </div>
                            <div className={`settings-toggle-row ${telegramBotNotificationsEnabled ? "" : "disabled"}`}>
                                <span>{t("settings.notifications.kind.bonus", lang)}</span>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={telegramBotNotificationKinds.bonus}
                                    disabled={!telegramBotNotificationsEnabled || telegramBotNotificationsBusy}
                                    className={`settings-ios-switch ${telegramBotNotificationKinds.bonus ? "checked" : ""}`}
                                    onClick={() => { void toggleTelegramBotKind("bonus") }}
                                >
                                    <span className="settings-ios-thumb" />
                                </button>
                            </div>
                            <div className={`settings-toggle-row ${telegramBotNotificationsEnabled ? "" : "disabled"}`}>
                                <span>{t("settings.notifications.kind.deposit", lang)}</span>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={telegramBotNotificationKinds.deposit}
                                    disabled={!telegramBotNotificationsEnabled || telegramBotNotificationsBusy}
                                    className={`settings-ios-switch ${telegramBotNotificationKinds.deposit ? "checked" : ""}`}
                                    onClick={() => { void toggleTelegramBotKind("deposit") }}
                                >
                                    <span className="settings-ios-thumb" />
                                </button>
                            </div>
                            <div className={`settings-toggle-row ${telegramBotNotificationsEnabled ? "" : "disabled"}`}>
                                <span>{t("settings.notifications.kind.news", lang)}</span>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={telegramBotNotificationKinds.news}
                                    disabled={!telegramBotNotificationsEnabled || telegramBotNotificationsBusy}
                                    className={`settings-ios-switch ${telegramBotNotificationKinds.news ? "checked" : ""}`}
                                    onClick={() => { void toggleTelegramBotKind("news") }}
                                >
                                    <span className="settings-ios-thumb" />
                                </button>
                            </div>
                            <div className={`settings-toggle-row ${telegramBotNotificationsEnabled ? "" : "disabled"}`}>
                                <span>{t("settings.notifications.kind.referral", lang)}</span>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={telegramBotNotificationKinds.referral}
                                    disabled={!telegramBotNotificationsEnabled || telegramBotNotificationsBusy}
                                    className={`settings-ios-switch ${telegramBotNotificationKinds.referral ? "checked" : ""}`}
                                    onClick={() => { void toggleTelegramBotKind("referral") }}
                                >
                                    <span className="settings-ios-thumb" />
                                </button>
                            </div>
                        </>
                    ) : null}
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
