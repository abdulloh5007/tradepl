import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react"
import { Camera, ChevronRight, Settings2, ShieldCheck, Trophy, User, Users } from "lucide-react"
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
    const bannerInputRef = useRef<HTMLInputElement | null>(null)
    const avatarInputRef = useRef<HTMLInputElement | null>(null)
    const [showSettings, setShowSettings] = useState(false)
    const [referralBusy, setReferralBusy] = useState(false)
    const [showProfitStages, setShowProfitStages] = useState(false)
    const [showKYCPage, setShowKYCPage] = useState(false)
    const [showReferralPage, setShowReferralPage] = useState(false)
    const [customBannerUrl, setCustomBannerUrl] = useState("")
    const [customAvatarUrl, setCustomAvatarUrl] = useState("")

    const displayName = useMemo(() => {
        const preferred = (profile?.display_name || "").trim()
        if (preferred) return preferred
        const fromEmail = (profile?.email || "").trim()
        if (fromEmail) return fromEmail
        return t("profile.trader", lang)
    }, [profile, lang])

    const profileStorageID = useMemo(() => {
        const rawID = String(profile?.id || "").trim()
        return rawID || "guest"
    }, [profile?.id])
    const bannerStorageKey = useMemo(() => `profile_banner_${profileStorageID}`, [profileStorageID])
    const avatarStorageKey = useMemo(() => `profile_avatar_${profileStorageID}`, [profileStorageID])

    useEffect(() => {
        try {
            setCustomBannerUrl(String(window.localStorage.getItem(bannerStorageKey) || ""))
            setCustomAvatarUrl(String(window.localStorage.getItem(avatarStorageKey) || ""))
        } catch {
            setCustomBannerUrl("")
            setCustomAvatarUrl("")
        }
    }, [bannerStorageKey, avatarStorageKey])

    const readAsDataURL = (file: File) =>
        new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onerror = () => reject(reader.error || new Error("read_failed"))
            reader.onload = () => resolve(String(reader.result || ""))
            reader.readAsDataURL(file)
        })

    const pickImage = async (
        file: File | undefined,
        setState: (value: string) => void,
        storageKey: string
    ) => {
        if (!file || !file.type.startsWith("image/")) return
        try {
            const dataURL = await readAsDataURL(file)
            if (!dataURL) return
            setState(dataURL)
            try {
                window.localStorage.setItem(storageKey, dataURL)
            } catch {
                // Ignore quota/storage errors, image still applies for current session.
            }
        } catch {
            // Ignore picker/read errors to keep UX interruption-free.
        }
    }

    const onPickBanner = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        await pickImage(file, setCustomBannerUrl, bannerStorageKey)
        event.target.value = ""
    }

    const onPickAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        await pickImage(file, setCustomAvatarUrl, avatarStorageKey)
        event.target.value = ""
    }

    const avatarUrl = (profile?.avatar_url || "").trim()
    const activeAvatarUrl = (customAvatarUrl || avatarUrl).trim()
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
                <div className="profile-user-card profile-user-card--cover">
                    <div
                        className={`profile-banner ${customBannerUrl ? "profile-banner--image" : ""}`}
                        style={customBannerUrl ? { backgroundImage: `url(${customBannerUrl})` } : undefined}
                    >
                        <div className="profile-banner-grid" />
                        <div className="profile-banner-particles">
                            {Array.from({ length: 12 }).map((_, index) => (
                                <span
                                    // eslint-disable-next-line react/no-array-index-key
                                    key={index}
                                    className={`profile-banner-particle ${index % 2 === 0 ? "gain" : "loss"} p${index + 1}`}
                                />
                            ))}
                        </div>
                        <svg className="profile-banner-signal gain" viewBox="0 0 180 36" aria-hidden="true">
                            <polyline points="0,28 20,24 32,26 56,14 76,20 98,8 116,14 136,4 158,12 180,6" />
                        </svg>
                        <svg className="profile-banner-signal loss" viewBox="0 0 180 36" aria-hidden="true">
                            <polyline points="0,8 18,10 36,6 56,16 74,12 92,20 110,16 132,28 154,22 180,30" />
                        </svg>
                        <div className="profile-banner-brand" aria-hidden="true">BIAX</div>
                        <button
                            type="button"
                            className="profile-banner-edit-btn"
                            onClick={() => bannerInputRef.current?.click()}
                            aria-label={t("profile.changeBanner", lang)}
                        >
                            <Camera size={15} />
                        </button>
                        <input
                            ref={bannerInputRef}
                            type="file"
                            accept="image/*"
                            onChange={onPickBanner}
                            className="profile-image-input"
                        />
                    </div>

                    <div className="profile-avatar-float">
                        {activeAvatarUrl ? (
                            <img
                                src={activeAvatarUrl}
                                alt={displayName}
                                className="profile-avatar-img"
                            />
                        ) : (
                            <div className="profile-avatar-fallback">
                                {initial || <User size={34} />}
                            </div>
                        )}
                        <button
                            type="button"
                            className="profile-avatar-edit-btn"
                            onClick={() => avatarInputRef.current?.click()}
                            aria-label={t("profile.changeAvatar", lang)}
                        >
                            <Camera size={14} />
                        </button>
                        <input
                            ref={avatarInputRef}
                            type="file"
                            accept="image/*"
                            onChange={onPickAvatar}
                            className="profile-image-input"
                        />
                    </div>

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
