import PositionsTable from "../components/PositionsTable"
import type { Order, Quote, Lang, MarketConfig } from "../types"

interface PositionsPageProps {
    orders: Order[]
    quote: Quote | null
    marketPair: string
    marketConfig: Record<string, MarketConfig>
    marketPrice: number
    onClose: (orderId: string) => void
    lang: Lang
}

export default function PositionsPage({
    orders,
    quote,
    marketPair,
    marketConfig,
    marketPrice,
    onClose,
    lang
}: PositionsPageProps) {
    return (
        <div style={{ maxWidth: 1200 }}>
            <h2 style={{ marginBottom: 16 }}>Open Positions</h2>
            <PositionsTable
                orders={orders}
                quote={quote}
                marketPair={marketPair}
                marketConfig={marketConfig}
                marketPrice={marketPrice}
                onClose={onClose}
                lang={lang}
            />
        </div>
    )
}
