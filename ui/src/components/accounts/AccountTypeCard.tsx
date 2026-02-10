
import { Check } from "lucide-react"

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
}

export default function AccountTypeCard({ plan }: AccountTypeProps): JSX.Element {
    return (
        <div className="atc-card">

            {/* 3D Object / Image Placeholder */}
            <div className="atc-image-container">
                {/* Dynamic Logo based on plan ID */}
                <div className={`atc-logo atc-logo-${plan.id}`}>
                    <div className="atc-logo-inner" />
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
