import { ArrowLeft, Share2, Users } from "lucide-react"
import { toast } from "sonner"
import type { ReferralStatus } from "../../api"
import type { Lang } from "../../types"
import { t } from "../../utils/i18n"
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
        <div className="ref-page">
            <div className="ref-page-header">
                <button type="button" className="ref-page-back" onClick={onBack} aria-label={t("profitStages.backToProfile", lang)}>
                    <ArrowLeft size={17} />
                </button>
                <h2>{t("profile.referral", lang)}</h2>
            </div>

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
        </div>
    )
}

