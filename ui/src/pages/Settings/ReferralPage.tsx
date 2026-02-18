import { Share2, Users } from "lucide-react"
import { toast } from "sonner"
import type { ReferralStatus } from "../../api"
import type { Lang } from "../../types"
import { t } from "../../utils/i18n"
import TelegramBackButton from "../../components/telegram/TelegramBackButton"
import "./ReferralPage.css"

interface ReferralPageProps {
    lang: Lang
    status: ReferralStatus | null
    busy: boolean
    onBack: () => void
    onWithdraw: (amountUSD?: string) => Promise<void>
    onRefresh?: () => Promise<void> | void
    setBusy: (busy: boolean) => void
}

export default function ReferralPage({
    lang,
    status,
    busy,
    onBack,
    onWithdraw,
    onRefresh,
    setBusy,
}: ReferralPageProps) {
    const referredUsers = Array.isArray(status?.referred_users) ? status?.referred_users : []

    const openTelegramProfile = (telegramID?: number) => {
        const id = Number(telegramID || 0)
        if (!Number.isFinite(id) || id <= 0) return
        const tgURL = `https://t.me/@id${id}`
        try {
            if (window.Telegram?.WebApp?.openTelegramLink) {
                window.Telegram.WebApp.openTelegramLink(tgURL)
                return
            }
        } catch {
            // fallback
        }
        window.open(tgURL, "_blank", "noopener,noreferrer")
    }

    const handleShare = () => {
        if (!status?.share_url) {
            toast.error(t("profile.referralLinkUnavailable", lang))
            return
        }
        const text = t("profile.referralShareText", lang)
        const shareURL = `https://t.me/share/url?url=${encodeURIComponent(status.share_url)}&text=${encodeURIComponent(text)}`
        try {
            if (window.Telegram?.WebApp?.openTelegramLink) {
                window.Telegram.WebApp.openTelegramLink(shareURL)
                return
            }
        } catch {
            // fallback
        }
        window.open(shareURL, "_blank", "noopener,noreferrer")
    }

    const handleWithdraw = async () => {
        if (!status) return
        if (status.real_account_required) {
            toast.error(t("profile.createRealAccountFirst", lang))
            return
        }
        if (!status.can_withdraw) {
            toast.error(t("profile.referralMinWithdraw", lang).replace("{amount}", String(status.min_withdraw_usd)))
            return
        }
        const raw = window.prompt(
            t("profile.referralWithdrawPrompt", lang).replace("{amount}", String(status.min_withdraw_usd)),
            status.balance
        )
        if (raw === null) return
        const amount = String(raw || "").trim()
        setBusy(true)
        try {
            await onWithdraw(amount || undefined)
            await onRefresh?.()
            toast.success(t("profile.referralWithdrawCompleted", lang))
        } catch (err: any) {
            toast.error(err?.message || t("profile.referralWithdrawFailed", lang))
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="ref-page app-page-top-offset">
            <TelegramBackButton onBack={onBack} showFallback={false} />

            <section className="ref-page-card">
                <div className="ref-page-head">
                    <span className="ref-page-chip">
                        <Users size={13} />
                        {t("profile.referral", lang)}
                    </span>
                    <span>{t("profile.invitedCount", lang).replace("{count}", String(status?.referrals_total || 0))}</span>
                </div>

                <div className="ref-page-balance">${status?.balance || "0.00"}</div>
                <div className="ref-page-meta">
                    <span>{t("profile.earned", lang)} ${status?.total_earned || "0.00"}</span>
                    <span>{t("profile.withdrawn", lang)} ${status?.total_withdrawn || "0.00"}</span>
                </div>
                <div className="ref-page-note">
                    {t("profile.referralNote", lang)
                        .replace("{reward}", String(status?.signup_reward_usd || 0))
                        .replace("{percent}", String(status?.deposit_commission_percent || 0))}
                </div>

                <div className="ref-page-actions">
                    <button type="button" className="ref-page-btn" onClick={handleShare}>
                        <Share2 size={14} />
                        <span>{t("profile.share", lang)}</span>
                    </button>
                    <button
                        type="button"
                        className="ref-page-btn ref-page-btn-primary"
                        onClick={handleWithdraw}
                        disabled={busy || !status?.can_withdraw || Boolean(status?.real_account_required)}
                    >
                        <span>{busy ? "..." : t("accounts.withdraw", lang)}</span>
                    </button>
                </div>
            </section>

            <section className="ref-page-card">
                <div className="ref-page-head">
                    <span className="ref-page-chip">
                        <Users size={13} />
                        {t("profile.referralUsersTitle", lang)}
                    </span>
                    <span>{referredUsers.length}</span>
                </div>

                {referredUsers.length === 0 ? (
                    <div className="ref-page-users-empty">{t("profile.referralUsersEmpty", lang)}</div>
                ) : (
                    <div className="ref-page-users-list">
                        {referredUsers.map((item) => {
                            const name = String(item?.display_name || "").trim() || "User"
                            const avatarURL = String(item?.avatar_url || "").trim()
                            const telegramID = Number(item?.telegram_id || 0)
                            const canOpen = Number.isFinite(telegramID) && telegramID > 0
                            const initial = name.charAt(0).toUpperCase()
                            return (
                                <button
                                    key={String(item?.user_id || `${name}-${telegramID}`)}
                                    type="button"
                                    className={`ref-page-user-item ${canOpen ? "is-clickable" : "is-static"}`}
                                    onClick={() => openTelegramProfile(telegramID)}
                                    disabled={!canOpen}
                                    title={canOpen ? `ID ${telegramID}` : ""}
                                >
                                    {avatarURL ? (
                                        <img src={avatarURL} alt={name} className="ref-page-user-avatar" />
                                    ) : (
                                        <span className="ref-page-user-avatar ref-page-user-avatar-fallback">{initial}</span>
                                    )}
                                    <span className="ref-page-user-name">{name}</span>
                                </button>
                            )
                        })}
                    </div>
                )}
            </section>
        </div>
    )
}
