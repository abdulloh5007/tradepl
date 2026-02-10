
import { useState, useRef, useEffect } from "react"
import { X } from "lucide-react"
import AccountTypeCard from "./AccountTypeCard"
import { toast } from "sonner"
import "./SharedAccountSheet.css"

interface AccountCreationModalProps {
    open: boolean
    onClose: () => void
    onCreate: (payload: { plan_id: string; mode: "demo" | "real"; name?: string; is_active?: boolean }) => Promise<void>
}

const PLANS = [
    {
        id: "standard",
        title: "Standard",
        badge: "Standard",
        description: "Low minimum deposit with no commission. Made for all traders.",
        minDeposit: "10 USD",
        minSpread: "0.2 pips",
        maxLeverage: "1:Unlimited",
        commission: "No commission",
        image: "https://my.lightvidy.com/assets/standard-account.png"
    },
    {
        id: "pro",
        title: "Pro",
        badge: "Most Popular",
        description: "Raw spreads from 0.0 pips with low commission.",
        minDeposit: "100 USD",
        minSpread: "0.0 pips",
        maxLeverage: "1:Unlimited",
        commission: "3.5 USD per lot",
        image: "https://my.lightvidy.com/assets/pro-account.png"
    },
    {
        id: "raw",
        title: "Raw Spread",
        badge: "Professional",
        description: "Lowest possible spreads for scalpers and EAs.",
        minDeposit: "500 USD",
        minSpread: "0.0 pips",
        maxLeverage: "1:Unlimited",
        commission: "3.5 USD per lot",
        image: "https://my.lightvidy.com/assets/raw-account.png"
    },
    {
        id: "swapfree",
        title: "Swap Free",
        badge: "Islamic",
        description: "Trade without swap fees on overnight positions.",
        minDeposit: "100 USD",
        minSpread: "0.5 pips",
        maxLeverage: "1:Unlimited",
        commission: "No commission",
        image: "https://my.lightvidy.com/assets/swapfree-account.png"
    }
]

export default function AccountCreationModal({ open, onClose, onCreate }: AccountCreationModalProps): JSX.Element | null {
    const [mode, setMode] = useState<"real" | "demo">("demo")
    const [activeIndex, setActiveIndex] = useState(0)
    const [creating, setCreating] = useState(false)
    const scrollRef = useRef<HTMLDivElement>(null)

    // Reset state when opening
    useEffect(() => {
        if (open) {
            setActiveIndex(0)
            if (scrollRef.current) {
                scrollRef.current.scrollTo({ left: 0, behavior: "instant" })
            }
        }
    }, [open])

    // Handle scroll snap updates
    const handleScroll = () => {
        if (!scrollRef.current) return
        const scrollLeft = scrollRef.current.scrollLeft
        const width = scrollRef.current.offsetWidth
        const index = Math.round(scrollLeft / width)
        setActiveIndex(index)
    }

    const scrollToCard = (index: number) => {
        if (!scrollRef.current) return
        const width = scrollRef.current.offsetWidth
        scrollRef.current.scrollTo({
            left: width * index,
            behavior: 'smooth'
        })
        setActiveIndex(index)
    }

    const handleCreate = async () => {
        setCreating(true)
        try {
            const plan = PLANS[activeIndex]
            await onCreate({
                plan_id: plan.id,
                mode: mode,
                name: `${mode === "demo" ? "Demo" : "Real"} ${plan.title}`,
                is_active: true
            })
            toast.success(`${plan.title} account created`)
            onClose()
        } catch (err) {
            console.error(err)
            toast.error("Failed to create account")
        } finally {
            setCreating(false)
        }
    }

    if (!open) return null

    return (
        <div className="acm-overlay">
            <div className="acm-backdrop" onClick={onClose} />
            <div className="acm-sheet">
                {/* Header */}
                <div className="acm-header">
                    <button onClick={onClose} className="acm-close-btn">
                        <X size={24} />
                    </button>
                    <h2 className="acm-title">Open account</h2>
                    <div className="acm-spacer" />
                </div>

                {/* Scrollable Content */}
                <div className="acm-content">
                    {/* Tabs */}
                    <div className="acm-tabs-container">
                        <div className="acm-tabs">
                            <button
                                onClick={() => setMode("real")}
                                className={`acm-tab ${mode === "real" ? "active" : ""}`}
                            >
                                Real
                            </button>
                            <button
                                onClick={() => setMode("demo")}
                                className={`acm-tab ${mode === "demo" ? "active" : ""}`}
                            >
                                Demo
                            </button>
                        </div>
                    </div>

                    {/* Swipeable Cards Area */}
                    <div
                        ref={scrollRef}
                        onScroll={handleScroll}
                        className="acm-scroll-container"
                    >
                        <div className="acm-cards-wrapper">
                            {PLANS.map((plan) => (
                                <div key={plan.id} className="acm-card-slide">
                                    <AccountTypeCard plan={plan} mode={mode} />
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Pagination Dots */}
                    <div className="acm-dots">
                        {PLANS.map((_, i) => (
                            <button
                                key={i}
                                onClick={() => scrollToCard(i)}
                                className={`acm-dot ${i === activeIndex ? "active" : ""}`}
                                aria-label={`Scroll to account type ${i + 1}`}
                                type="button"
                            />
                        ))}
                    </div>
                </div>

                {/* Footer */}
                <div className="acm-footer">
                    <div className="acm-contract-specs">
                        <p className="acm-contract-title">Contract specifications</p>
                        <p className="acm-contract-desc">
                            Full breakdown of instrument terms, costs, and trading hours.
                        </p>
                    </div>

                    <button
                        onClick={handleCreate}
                        disabled={creating}
                        className="acm-submit-btn"
                    >
                        {creating ? "Creating..." : "Continue"}
                    </button>
                </div>
            </div>
        </div>
    )
}
