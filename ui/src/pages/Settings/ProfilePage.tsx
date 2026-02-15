import { useEffect, useMemo, useState } from "react"
import { ChevronRight, Settings2, ShieldCheck, Trophy, User, Users } from "lucide-react"
import type { KYCStatus, ProfitRewardStatus, ReferralStatus, UserProfile } from "../../api"
import type { Lang, NotificationSettings, Theme, TradingAccount } from "../../types"
import ProfitStagesPage from "./ProfitStagesPage"
import SettingsPage from "./SettingsPage"
import KYCPage from "./KYCPage"
import ReferralPage from "./ReferralPage"
import { t } from "../../utils/i18n"
import "./ProfilePage.css"

interface ProfilePageProps {
    lang: Lang
    setLang: (lang: Lang) => void
    theme: Theme
    setTheme: (theme: Theme) => void
    onLogout: () => void
    profile: UserProfile | null
    notificationSettings: NotificationSettings
    setNotificationSettings: (settings: NotificationSettings) => void
    telegramBotSwitchVisible: boolean
    telegramBotNotificationsEnabled: boolean
    telegramBotNotificationsBusy: boolean
    telegramWriteAccess: boolean
    onToggleTelegramBotNotifications: (enabled: boolean) => Promise<void> | void
    activeAccount: TradingAccount | null
    kycStatus: KYCStatus | null
    onRequestKYC: (payload: {
        documentType: "passport" | "id_card" | "driver_license" | "other"
        fullName: string
        documentNumber: string
        residenceAddress: string
        frontProofFile: File
        backProofFile: File
    }) => Promise<void>
    referralStatus: ReferralStatus | null
    onReferralWithdraw: (amountUSD?: string) => Promise<void>
    onRefreshReferral?: () => Promise<void> | void
    profitRewardStatus: ProfitRewardStatus | null
    onRefreshProfitReward: () => Promise<void> | void
    onClaimProfitReward: (stageNo: number, tradingAccountID: string) => Promise<void>
    accounts: TradingAccount[]
    openProfitStagesSignal?: number
}

export default function ProfilePage({
    lang,
    setLang,
    theme,
    setTheme,
    onLogout,
    profile,
    notificationSettings,
    setNotificationSettings,
    telegramBotSwitchVisible,
    telegramBotNotificationsEnabled,
    telegramBotNotificationsBusy,
    telegramWriteAccess,
    onToggleTelegramBotNotifications,
    activeAccount,
    kycStatus,
    onRequestKYC,
    referralStatus,
    onReferralWithdraw,
    onRefreshReferral,
    profitRewardStatus,
    onRefreshProfitReward,
    onClaimProfitReward,
    accounts,
    openProfitStagesSignal = 0,
}: ProfilePageProps) {
    const [showSettings, setShowSettings] = useState(false)
    const [referralBusy, setReferralBusy] = useState(false)
    const [showProfitStages, setShowProfitStages] = useState(false)
    const [showKYCPage, setShowKYCPage] = useState(false)
    const [showReferralPage, setShowReferralPage] = useState(false)

    const displayName = useMemo(() => {
        const preferred = (profile?.display_name || "").trim()
        if (preferred) return preferred
        const fromEmail = (profile?.email || "").trim()
        if (fromEmail) return fromEmail
        return t("profile.trader", lang)
    }, [profile, lang])

    const avatarUrl = (profile?.avatar_url || "").trim()
    const initial = displayName.charAt(0).toUpperCase()
    const kycState = String(kycStatus?.state || "unavailable")
    const kycPending = kycState === "pending"
    const kycApproved = kycState === "approved" || Boolean(kycStatus?.claimed)
    const kycLabel = kycApproved
        ? t("profile.verified", lang)
        : kycPending
            ? t("profile.inReview", lang)
            : t("profile.notVerified", lang)
    const referralLabel = referralStatus
        ? `${t("profile.invitedCount", lang).replace("{count}", String(referralStatus.referrals_total))} • $${referralStatus.balance}`
        : "—"

    useEffect(() => {
        if (!openProfitStagesSignal) return
        setShowSettings(false)
        setShowKYCPage(false)
        setShowReferralPage(false)
        setShowProfitStages(true)
    }, [openProfitStagesSignal])

    if (showProfitStages) {
        return (
            <ProfitStagesPage
                lang={lang}
                status={profitRewardStatus}
                accounts={accounts}
                onBack={() => setShowProfitStages(false)}
                onRefresh={onRefreshProfitReward}
                onClaim={onClaimProfitReward}
            />
        )
    }

    if (showKYCPage) {
        return (
            <KYCPage
                lang={lang}
                activeAccount={activeAccount}
                status={kycStatus}
                onRequestKYC={onRequestKYC}
                onBack={() => setShowKYCPage(false)}
            />
        )
    }

    if (showReferralPage) {
        return (
            <ReferralPage
                lang={lang}
                status={referralStatus}
                busy={referralBusy}
                setBusy={setReferralBusy}
                onWithdraw={onReferralWithdraw}
                onRefresh={onRefreshReferral}
                onBack={() => setShowReferralPage(false)}
            />
        )
    }

    if (showSettings) {
        return (
            <SettingsPage
                lang={lang}
                setLang={setLang}
                theme={theme}
                setTheme={setTheme}
                notificationSettings={notificationSettings}
                setNotificationSettings={setNotificationSettings}
                telegramBotSwitchVisible={telegramBotSwitchVisible}
                telegramBotNotificationsEnabled={telegramBotNotificationsEnabled}
                telegramBotNotificationsBusy={telegramBotNotificationsBusy}
                telegramWriteAccess={telegramWriteAccess}
                onToggleTelegramBotNotifications={onToggleTelegramBotNotifications}
                onBack={() => setShowSettings(false)}
                onLogout={onLogout}
            />
        )
    }

    return (
        <div className="profile-page">
            <div className="profile-header">
                <h2 className="profile-title">{t("profile", lang)}</h2>
                <button
                    onClick={() => setShowSettings(true)}
                    className="profile-settings-btn"
                    aria-label={t("profile.openSettings", lang)}
                    type="button"
                >
                    <Settings2 size={20} />
                </button>
            </div>

            <div className="profile-user-wrap">
                <div className="profile-user-card">
                    {avatarUrl ? (
                        <img
                            src={avatarUrl}
                            alt={displayName}
                            className="profile-avatar-img"
                        />
                    ) : (
                        <div className="profile-avatar-fallback">
                            {initial || <User size={34} />}
                        </div>
                    )}
                    <h3 className="profile-display-name">{displayName}</h3>
                </div>
            </div>

            <button
                type="button"
                className="profile-nav-item"
                onClick={() => setShowKYCPage(true)}
            >
                <span className="profile-nav-left">
                    <ShieldCheck size={15} />
                    {t("profile.identityBonus", lang)}
                </span>
                <span className="profile-nav-right">{kycLabel}</span>
                <ChevronRight size={16} />
            </button>

            <div className="profile-nav-group">
                <button
                    type="button"
                    className="profile-nav-item profile-nav-item-group"
                    onClick={() => setShowReferralPage(true)}
                >
                    <span className="profile-nav-left">
                        <Users size={15} />
                        {t("profile.referral", lang)}
                    </span>
                    <span className="profile-nav-right">{referralLabel}</span>
                    <ChevronRight size={16} />
                </button>

                <button
                    type="button"
                    className="profile-nav-item profile-nav-item-group"
                    onClick={() => setShowProfitStages(true)}
                >
                    <span className="profile-nav-left">
                        <Trophy size={15} />
                        {t("profile.profitStages", lang)}
                    </span>
                    <span className="profile-nav-right">{t("profile.open", lang)}</span>
                    <ChevronRight size={16} />
                </button>
            </div>

        </div>
    )
}
