import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Settings2, Share2, ShieldCheck, User } from "lucide-react"
import type { KYCStatus, ProfitRewardStatus, ReferralStatus, UserProfile } from "../../api"
import type { Lang, Theme, TradingAccount } from "../../types"
import KYCVerificationModal from "../../components/accounts/KYCVerificationModal"
import ProfitStagesPage from "./ProfitStagesPage"
import SettingsSheet from "./SettingsSheet"
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
        return "Trader"
    }, [profile])

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
            toast.error("Switch to active Real Standard account")
            return
        }
        if (!kycStatus?.can_submit) {
            toast.error(kycStatus?.message || "KYC submission is unavailable")
            return
        }
        setKycModalOpen(true)
    }

    const handleShareReferral = () => {
        if (!referralStatus?.share_url) {
            toast.error("Referral link is unavailable")
            return
        }
        const text = "Join LV Trade with my referral link."
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
            toast.error("Create a real account first")
            return
        }
        if (!referralStatus.can_withdraw) {
            toast.error(`Minimum referral balance for withdraw is ${referralStatus.min_withdraw_usd} USD`)
            return
        }
        const raw = window.prompt(
            `Withdraw amount in USD (min ${referralStatus.min_withdraw_usd}). Leave empty to withdraw full balance.`,
            referralStatus.balance
        )
        if (raw === null) return
        const amount = String(raw || "").trim()
        setReferralBusy(true)
        try {
            await onReferralWithdraw(amount || undefined)
            await onRefreshReferral?.()
            toast.success("Referral withdrawal completed")
        } catch (err: any) {
            toast.error(err?.message || "Referral withdrawal failed")
        } finally {
            setReferralBusy(false)
        }
    }

    if (showProfitStages) {
        return (
            <ProfitStagesPage
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
                <h2 className="profile-title">Profile</h2>
                <button
                    onClick={() => setShowSettings(true)}
                    className="profile-settings-btn"
                    aria-label="Open settings"
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
                        <h3>Referral</h3>
                        <span>{referralStatus.referrals_total} invited</span>
                    </div>
                    <div className="profile-referral-balance">${referralStatus.balance}</div>
                    <div className="profile-referral-meta">
                        <span>Earned ${referralStatus.total_earned}</span>
                        <span>Withdrawn ${referralStatus.total_withdrawn}</span>
                    </div>
                    <div className="profile-referral-note">
                        ${referralStatus.signup_reward_usd} per invite + {referralStatus.deposit_commission_percent}% from real deposits.
                    </div>
                    <div className="profile-referral-actions">
                        <button type="button" className="profile-referral-btn" onClick={handleShareReferral}>
                            <Share2 size={14} />
                            <span>Share</span>
                        </button>
                        <button
                            type="button"
                            className="profile-referral-btn profile-referral-btn-primary"
                            onClick={handleWithdrawReferral}
                            disabled={referralBusy || !referralStatus.can_withdraw || referralStatus.real_account_required}
                        >
                            <span>{referralBusy ? "..." : "Withdraw"}</span>
                        </button>
                    </div>
                </section>
            )}

            <section className="profile-kyc-card">
                <div className="profile-kyc-head">
                    <div className="profile-kyc-chip">
                        <ShieldCheck size={14} />
                        <span>Identity bonus</span>
                    </div>
                    <span className={`profile-kyc-state ${kycApproved ? "ok" : ""}`}>
                        {kycApproved ? "Verified" : kycPending ? "In review" : "KYC"}
                    </span>
                </div>
                <div className="profile-kyc-amount">+${kycBonusAmount}</div>
                <p className="profile-kyc-text">
                    One-time bonus after successful identity verification on Real Standard account.
                </p>
                {kycPending && kycStatus?.pending_ticket ? (
                    <div className="profile-kyc-note">Ticket: {kycStatus.pending_ticket}</div>
                ) : null}
                {kycBlockedTemp && kycBlockedLabel ? (
                    <div className="profile-kyc-note">Blocked for: {kycBlockedLabel}</div>
                ) : null}
                {kycBlockedPermanent ? (
                    <div className="profile-kyc-note">Permanently blocked. Contact support/owner.</div>
                ) : null}
                {!isRealStandard ? (
                    <div className="profile-kyc-note">Switch to active Real Standard account.</div>
                ) : null}
                {kycStatus && !kycStatus.is_review_configured ? (
                    <div className="profile-kyc-note">Review chat is not configured yet.</div>
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
                        ? "Already verified"
                        : kycPending
                            ? "Pending review"
                            : kycBlockedTemp
                                ? "Temporarily blocked"
                                : kycBlockedPermanent
                                    ? "Blocked"
                                    : "Verify identity"}
                </button>
            </section>

            <KYCVerificationModal
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
                        toast.success("KYC request submitted")
                        setKycModalOpen(false)
                    } catch (err: any) {
                        toast.error(err?.message || "Failed to submit KYC")
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
