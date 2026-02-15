
import { AnimationPlayer } from "../ui/AnimationPlayer"
import type { Lang } from "../../types"
import { t } from "../../utils/i18n"
import "./AccountTypeCard.css"

interface AccountTypeProps {
    lang: Lang
    plan: {
        id: string
        title: string
        badge: string
        description: string
        minDeposit: string
        minSpread: string
        maxLeverage: string
        commission: string
        image: string
        swapLongPerLot: number
        swapShortPerLot: number
        isSwapFree?: boolean
    }
    mode: "real" | "demo"
}

const TGS_PATHS: Record<string, string> = {
    standard: "/assets/tgs/standart.tgs", // Note: filename typo in assets "standart.tgs"
    pro: "/assets/tgs/pro.tgs",
    raw: "/assets/tgs/rawspread.tgs",
    swapfree: "/assets/tgs/swapfree.tgs"
}

export default function AccountTypeCard({ lang, plan, mode }: AccountTypeProps): JSX.Element {
    const tgsSrc = TGS_PATHS[plan.id] || TGS_PATHS.standard
    const swapValue = plan.isSwapFree
        ? t("accounts.details.swapFree", lang)
        : t("accounts.plan.swapLongShortCompact", lang)
            .replace("{long}", formatSwapRate(plan.swapLongPerLot))
            .replace("{short}", formatSwapRate(plan.swapShortPerLot))

    return (
        <div className="atc-card">
            {/* Ribbon */}
            <div className={`atc-ribbon atc-ribbon-${mode}`}>
                <span>{mode === "real" ? t("accounts.modeReal", lang).toUpperCase() : t("accounts.modeDemo", lang).toUpperCase()}</span>
            </div>

            {/* TGS Animation */}
            <div className="atc-image-container">
                <div style={{ width: 100, height: 100 }}>
                    <AnimationPlayer
                        src={tgsSrc}
                        style={{ width: '100%', height: '100%' }}
                    />
                </div>
            </div>

            <h3 className="atc-title">{t(plan.title, lang)}</h3>

            <span className="atc-badge">
                {t(plan.badge, lang)}
            </span>

            <p className="atc-description">
                {t(plan.description, lang)}
            </p>

            <div className="atc-details">
                <Row label={t("accounts.plan.minDeposit", lang)} value={t(plan.minDeposit, lang)} />
                <Row label={t("accounts.plan.minSpread", lang)} value={t(plan.minSpread, lang)} />
                <Row label={t("accounts.plan.maxLeverage", lang)} value={t(plan.maxLeverage, lang)} />
                <Row label={t("accounts.plan.commission", lang)} value={t(plan.commission, lang)} />
                <Row label={t("history.swap", lang)} value={swapValue} compact />
            </div>
        </div>
    )
}

function formatSwapRate(value: number): string {
    const abs = Math.abs(value).toFixed(2)
    if (value > 0) return `+${abs}`
    if (value < 0) return `-${abs}`
    return "0.00"
}

function Row({ label, value, compact = false }: { label: string, value: string, compact?: boolean }) {
    return (
        <div className="atc-row">
            <span className="atc-label">{label}</span>
            <div className="atc-dots" />
            <span className={`atc-value ${compact ? "atc-value-compact" : ""}`}>{value}</span>
        </div>
    )
}
