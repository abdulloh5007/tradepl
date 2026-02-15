import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Settings2, Share2, ShieldCheck, User } from "lucide-react"
import type { KYCStatus, ProfitRewardStatus, ReferralStatus, UserProfile } from "../../api"
import type { Lang, Theme, TradingAccount } from "../../types"
import KYCVerificationModal from "../../components/accounts/KYCVerificationModal"
import ProfitStagesPage from "./ProfitStagesPage"
import SettingsSheet from "./SettingsSheet"
import { t } from "../../utils/i18n"
import "./ProfilePage.css"

interface ProfilePageProps {
    lang: Lang
    setLang: (lang: Lang) => void
    theme: Theme
    setTheme: (theme: Theme) => void
    onLogout: () => void
    profile: UserProfile | null
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
}

const formatDuration = (seconds: number) => {
    const safe = Math.max(0, Math.floor(seconds))
    const days = Math.floor(safe / 86400)
    const hours = Math.floor((safe % 86400) / 3600)
    const mins = Math.floor((safe % 3600) / 60)
    if (days > 0) return `${days}d ${hours}h ${mins}m`
    if (hours > 0) return `${hours}h ${mins}m`
    return `${mins}m`
}

export default function ProfilePage({
    lang,
    setLang,
    theme,
    setTheme,
    onLogout,
    profile,
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
}: ProfilePageProps) {
    const [showSettings, setShowSettings] = useState(false)
    const [kycModalOpen, setKycModalOpen] = useState(false)
    const [kycBusy, setKycBusy] = useState(false)
    const [referralBusy, setReferralBusy] = useState(false)
    const [showProfitStages, setShowProfitStages] = useState(false)

    const displayName = useMemo(() => {
        const preferred = (profile?.display_name || "").trim()
        if (preferred) return preferred
        const fromEmail = (profile?.email || "").trim()
        if (fromEmail) return fromEmail
        return t("profile.trader", lang)
    }, [profile, lang])

    const avatarUrl = (profile?.avatar_url || "").trim()
    const initial = displayName.charAt(0).toUpperCase()
    const isRealStandard = activeAccount?.mode === "real" && activeAccount?.plan_id === "standard"

    const kycState = String(kycStatus?.state || "unavailable")
    const kycPending = kycState === "pending"
    const kycApproved = kycState === "approved" || Boolean(kycStatus?.claimed)
    const kycBlockedTemp = kycState === "blocked_temp"
    const kycBlockedPermanent = kycState === "blocked_permanent"
    const kycBlockedSeconds = Number(kycStatus?.blocked_seconds || 0)
    const kycBlockedLabel = kycBlockedTemp && kycBlockedSeconds > 0 ? formatDuration(kycBlockedSeconds) : ""
    const kycBonusAmount = String(kycStatus?.bonus_amount_usd || "50.00")

    const openKYCModal = () => {
        if (!isRealStandard) {
            toast.error(t("accounts.errors.switchRealStandard", lang))
            return
        }
        if (!kycStatus?.can_submit) {
            toast.error(kycStatus?.message || t("kyc.unavailable", lang))
            return
        }
        setKycModalOpen(true)
    }

    const handleShareReferral = () => {
        if (!referralStatus?.share_url) {
            toast.error(t("profile.referralLinkUnavailable", lang))
            return
        }
        const text = t("profile.referralShareText", lang)
        const shareURL = `https://t.me/share/url?url=${encodeURIComponent(referralStatus.share_url)}&text=${encodeURIComponent(text)}`
        try {
            if (window.Telegram?.WebApp?.openTelegramLink) {
                window.Telegram.WebApp.openTelegramLink(shareURL)
                return
            }
        } catch {
            // fallback below
        }
        window.open(shareURL, "_blank", "noopener,noreferrer")
    }

    const handleWithdrawReferral = async () => {
        if (!referralStatus) return
        if (referralStatus.real_account_required) {
            toast.error(t("profile.createRealAccountFirst", lang))
            return
        }
        if (!referralStatus.can_withdraw) {
            toast.error(t("profile.referralMinWithdraw", lang).replace("{amount}", String(referralStatus.min_withdraw_usd)))
            return
        }
        const raw = window.prompt(
            t("profile.referralWithdrawPrompt", lang).replace("{amount}", String(referralStatus.min_withdraw_usd)),
            referralStatus.balance
        )
        if (raw === null) return
        const amount = String(raw || "").trim()
        setReferralBusy(true)
        try {
            await onReferralWithdraw(amount || undefined)
            await onRefreshReferral?.()
            toast.success(t("profile.referralWithdrawCompleted", lang))
        } catch (err: any) {
            toast.error(err?.message || t("profile.referralWithdrawFailed", lang))
        } finally {
            setReferralBusy(false)
        }
    }

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

            {referralStatus && (
                <section className="profile-referral-card">
                    <div className="profile-referral-head">
                        <h3>{t("profile.referral", lang)}</h3>
                        <span>{t("profile.invitedCount", lang).replace("{count}", String(referralStatus.referrals_total))}</span>
                    </div>
                    <div className="profile-referral-balance">${referralStatus.balance}</div>
                    <div className="profile-referral-meta">
                        <span>{t("profile.earned", lang)} ${referralStatus.total_earned}</span>
                        <span>{t("profile.withdrawn", lang)} ${referralStatus.total_withdrawn}</span>
                    </div>
                    <div className="profile-referral-note">
                        {t("profile.referralNote", lang)
                            .replace("{reward}", String(referralStatus.signup_reward_usd))
                            .replace("{percent}", String(referralStatus.deposit_commission_percent))}
                    </div>
                    <div className="profile-referral-actions">
                        <button type="button" className="profile-referral-btn" onClick={handleShareReferral}>
                            <Share2 size={14} />
                            <span>{t("profile.share", lang)}</span>
                        </button>
                        <button
                            type="button"
                            className="profile-referral-btn profile-referral-btn-primary"
                            onClick={handleWithdrawReferral}
                            disabled={referralBusy || !referralStatus.can_withdraw || referralStatus.real_account_required}
                        >
                            <span>{referralBusy ? "..." : t("accounts.withdraw", lang)}</span>
                        </button>
                    </div>
                </section>
            )}

            <section className="profile-kyc-card">
                <div className="profile-kyc-head">
                    <div className="profile-kyc-chip">
                        <ShieldCheck size={14} />
                        <span>{t("profile.identityBonus", lang)}</span>
                    </div>
                    <span className={`profile-kyc-state ${kycApproved ? "ok" : ""}`}>
                        {kycApproved ? t("profile.verified", lang) : kycPending ? t("profile.inReview", lang) : "KYC"}
                    </span>
                </div>
                <div className="profile-kyc-amount">+${kycBonusAmount}</div>
                <p className="profile-kyc-text">
                    {t("profile.kycOneTimeBonus", lang)}
                </p>
                {kycPending && kycStatus?.pending_ticket ? (
                    <div className="profile-kyc-note">{t("profile.ticket", lang)}: {kycStatus.pending_ticket}</div>
                ) : null}
                {kycBlockedTemp && kycBlockedLabel ? (
                    <div className="profile-kyc-note">{t("profile.blockedFor", lang)}: {kycBlockedLabel}</div>
                ) : null}
                {kycBlockedPermanent ? (
                    <div className="profile-kyc-note">{t("profile.blockedPermanent", lang)}</div>
                ) : null}
                {!isRealStandard ? (
                    <div className="profile-kyc-note">{t("accounts.errors.switchRealStandard", lang)}</div>
                ) : null}
                {kycStatus && !kycStatus.is_review_configured ? (
                    <div className="profile-kyc-note">{t("profile.reviewChatNotConfigured", lang)}</div>
                ) : null}
                <button
                    type="button"
                    className="profile-kyc-btn"
                    onClick={openKYCModal}
                    disabled={
                        kycBusy ||
                        !isRealStandard ||
                        !kycStatus?.can_submit ||
                        kycPending ||
                        kycApproved ||
                        kycBlockedPermanent
                    }
                >
                    {kycApproved
                        ? t("profile.alreadyVerified", lang)
                        : kycPending
                            ? t("profile.pendingReview", lang)
                            : kycBlockedTemp
                                ? t("profile.temporarilyBlocked", lang)
                                : kycBlockedPermanent
                                    ? t("profile.blocked", lang)
                                    : t("profile.verifyIdentity", lang)}
                </button>
            </section>

            <KYCVerificationModal
                lang={lang}
                open={kycModalOpen}
                status={kycStatus}
                loading={kycBusy}
                onClose={() => {
                    if (kycBusy) return
                    setKycModalOpen(false)
                }}
                onSubmit={async (payload) => {
                    setKycBusy(true)
                    try {
                        await onRequestKYC(payload)
                        toast.success(t("profile.kycRequestSubmitted", lang))
                        setKycModalOpen(false)
                    } catch (err: any) {
                        toast.error(err?.message || t("profile.kycSubmitFailed", lang))
                    } finally {
                        setKycBusy(false)
                    }
                }}
            />

            <SettingsSheet
                open={showSettings}
                onClose={() => setShowSettings(false)}
                lang={lang}
                setLang={setLang}
                theme={theme}
                setTheme={setTheme}
                onLogout={onLogout}
                onOpenProfitStages={() => {
                    setShowSettings(false)
                    setShowProfitStages(true)
                }}
            />
        </div>
    )
}
