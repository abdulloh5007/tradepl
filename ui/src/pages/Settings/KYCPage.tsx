import { useMemo, useState } from "react"
import { toast } from "sonner"
import { ShieldCheck } from "lucide-react"
import type { KYCStatus } from "../../api"
import type { Lang, TradingAccount } from "../../types"
import KYCVerificationModal from "../../components/accounts/KYCVerificationModal"
import TelegramBackButton from "../../components/telegram/TelegramBackButton"
import { t } from "../../utils/i18n"
import "./KYCPage.css"

interface KYCPageProps {
    lang: Lang
    activeAccount: TradingAccount | null
    status: KYCStatus | null
    onRequestKYC: (payload: {
        documentType: "passport" | "id_card" | "driver_license" | "other"
        fullName: string
        documentNumber: string
        residenceAddress: string
        frontProofFile: File
        backProofFile: File
    }) => Promise<void>
    onBack: () => void
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

export default function KYCPage({
    lang,
    activeAccount,
    status,
    onRequestKYC,
    onBack,
}: KYCPageProps) {
    const [modalOpen, setModalOpen] = useState(false)
    const [busy, setBusy] = useState(false)

    const isRealStandard = activeAccount?.mode === "real" && activeAccount?.plan_id === "standard"
    const state = String(status?.state || "unavailable")
    const pending = state === "pending"
    const approved = state === "approved" || Boolean(status?.claimed)
    const blockedTemp = state === "blocked_temp"
    const blockedPermanent = state === "blocked_permanent"
    const blockedLabel = blockedTemp ? formatDuration(Number(status?.blocked_seconds || 0)) : ""

    const statusLabel = useMemo(() => {
        if (approved) return t("profile.verified", lang)
        if (pending) return t("profile.inReview", lang)
        return t("profile.notVerified", lang)
    }, [approved, pending, lang])

    const openModal = () => {
        if (!isRealStandard) {
            toast.error(t("accounts.errors.switchRealStandard", lang))
            return
        }
        if (!status?.can_submit) {
            toast.error(status?.message || t("kyc.unavailable", lang))
            return
        }
        setModalOpen(true)
    }

    return (
        <div className="kyc-page app-page-top-offset">
            <TelegramBackButton onBack={onBack} showFallback={false} />

            <section className="kyc-page-card">
                <div className="kyc-page-head">
                    <span className="kyc-page-chip">
                        <ShieldCheck size={13} />
                        {t("profile.identityBonus", lang)}
                    </span>
                    <span className={`kyc-page-status ${approved ? "ok" : pending ? "pending" : ""}`}>
                        {statusLabel}
                    </span>
                </div>

                <div className="kyc-page-bonus">+${String(status?.bonus_amount_usd || "50.00")}</div>
                <p className="kyc-page-text">{t("profile.kycOneTimeBonus", lang)}</p>

                {pending && status?.pending_ticket ? (
                    <div className="kyc-page-note">{t("profile.ticket", lang)}: {status.pending_ticket}</div>
                ) : null}
                {blockedTemp && blockedLabel ? (
                    <div className="kyc-page-note">{t("profile.blockedFor", lang)}: {blockedLabel}</div>
                ) : null}
                {blockedPermanent ? (
                    <div className="kyc-page-note">{t("profile.blockedPermanent", lang)}</div>
                ) : null}
                {!isRealStandard ? (
                    <div className="kyc-page-note">{t("accounts.errors.switchRealStandard", lang)}</div>
                ) : null}
                {status && !status.is_review_configured ? (
                    <div className="kyc-page-note">{t("profile.reviewChatNotConfigured", lang)}</div>
                ) : null}

                <button
                    type="button"
                    className="kyc-page-action"
                    onClick={openModal}
                    disabled={busy || !isRealStandard || !status?.can_submit || pending || approved || blockedPermanent}
                >
                    {approved
                        ? t("profile.alreadyVerified", lang)
                        : pending
                            ? t("profile.pendingReview", lang)
                            : blockedTemp
                                ? t("profile.temporarilyBlocked", lang)
                                : blockedPermanent
                                    ? t("profile.blocked", lang)
                                    : t("profile.verifyIdentity", lang)}
                </button>
            </section>

            <KYCVerificationModal
                lang={lang}
                open={modalOpen}
                status={status}
                loading={busy}
                onClose={() => {
                    if (busy) return
                    setModalOpen(false)
                }}
                onSubmit={async (payload) => {
                    setBusy(true)
                    try {
                        await onRequestKYC(payload)
                        toast.success(t("profile.kycRequestSubmitted", lang))
                        setModalOpen(false)
                    } catch (err: any) {
                        toast.error(err?.message || t("profile.kycSubmitFailed", lang))
                    } finally {
                        setBusy(false)
                    }
                }}
            />
        </div>
    )
}
