
import { AnimationPlayer } from "../ui/AnimationPlayer"

interface AccountTypeProps {
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
    }
    mode: "real" | "demo"
}

const TGS_PATHS: Record<string, string> = {
    standard: "/assets/tgs/standart.tgs", // Note: filename typo in assets "standart.tgs"
    pro: "/assets/tgs/pro.tgs",
    raw: "/assets/tgs/rawspread.tgs",
    swapfree: "/assets/tgs/swapfree.tgs"
}

export default function AccountTypeCard({ plan, mode }: AccountTypeProps): JSX.Element {
    const tgsSrc = TGS_PATHS[plan.id] || TGS_PATHS.standard

    return (
        <div className="atc-card">
            {/* Ribbon */}
            <div className={`atc-ribbon atc-ribbon-${mode}`}>
                <span>{mode === "real" ? "REAL" : "DEMO"}</span>
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

            <h3 className="atc-title">{plan.title}</h3>

            <span className="atc-badge">
                {plan.badge}
            </span>

            <p className="atc-description">
                {plan.description}
            </p>

            <div className="atc-details">
                <Row label="Min deposit" value={plan.minDeposit} />
                <Row label="Min spread" value={plan.minSpread} />
                <Row label="Max leverage" value={plan.maxLeverage} />
                <Row label="Commission" value={plan.commission} />
            </div>
        </div>
    )
}

function Row({ label, value }: { label: string, value: string }) {
    return (
        <div className="atc-row">
            <span className="atc-label">{label}</span>
            <div className="atc-dots" />
            <span className="atc-value">{value}</span>
        </div>
    )
}
