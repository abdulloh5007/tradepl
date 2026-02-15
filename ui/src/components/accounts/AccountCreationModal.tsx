
import { useState, useRef, useEffect } from "react"
import { X } from "lucide-react"
import AccountTypeCard from "./AccountTypeCard"
import { toast } from "sonner"
import type { Lang } from "../../types"
import { t } from "../../utils/i18n"
import { useAnimatedPresence } from "../../hooks/useAnimatedPresence"
import "./SharedAccountSheet.css"

interface AccountCreationModalProps {
    lang: Lang
    open: boolean
    onClose: () => void
    onCreate: (payload: { plan_id: string; mode: "demo" | "real"; name?: string; is_active?: boolean }) => Promise<void>
}

const PLANS = [
    {
        id: "standard",
        title: "accounts.plan.standard.title",
        badge: "accounts.plan.standard.badge",
        description: "accounts.plan.standard.description",
        minDeposit: "accounts.plan.standard.minDeposit",
        minSpread: "accounts.plan.standard.minSpread",
        maxLeverage: "accounts.plan.standard.maxLeverage",
        commission: "accounts.plan.standard.commission",
        image: "https://my.lightvidy.com/assets/standard-account.png"
    },
    {
        id: "pro",
        title: "accounts.plan.pro.title",
        badge: "accounts.plan.pro.badge",
        description: "accounts.plan.pro.description",
        minDeposit: "accounts.plan.pro.minDeposit",
        minSpread: "accounts.plan.pro.minSpread",
        maxLeverage: "accounts.plan.pro.maxLeverage",
        commission: "accounts.plan.pro.commission",
        image: "https://my.lightvidy.com/assets/pro-account.png"
    },
    {
        id: "raw",
        title: "accounts.plan.raw.title",
        badge: "accounts.plan.raw.badge",
        description: "accounts.plan.raw.description",
        minDeposit: "accounts.plan.raw.minDeposit",
        minSpread: "accounts.plan.raw.minSpread",
        maxLeverage: "accounts.plan.raw.maxLeverage",
        commission: "accounts.plan.raw.commission",
        image: "https://my.lightvidy.com/assets/raw-account.png"
    },
    {
        id: "swapfree",
        title: "accounts.plan.swapfree.title",
        badge: "accounts.plan.swapfree.badge",
        description: "accounts.plan.swapfree.description",
        minDeposit: "accounts.plan.swapfree.minDeposit",
        minSpread: "accounts.plan.swapfree.minSpread",
        maxLeverage: "accounts.plan.swapfree.maxLeverage",
        commission: "accounts.plan.swapfree.commission",
        image: "https://my.lightvidy.com/assets/swapfree-account.png"
    }
]

export default function AccountCreationModal({ lang, open, onClose, onCreate }: AccountCreationModalProps): JSX.Element | null {
    const { shouldRender, isVisible } = useAnimatedPresence(open, 220)
    const [mode, setMode] = useState<"real" | "demo">("demo")
    const [activeIndex, setActiveIndex] = useState(0)
    const [creating, setCreating] = useState(false)
    const scrollRef = useRef<HTMLDivElement>(null)

    // Reset state when opening
    useEffect(() => {
        if (open) {
            setActiveIndex(0)
            if (scrollRef.current) {
                scrollRef.current.scrollTo({ left: 0, behavior: "auto" })
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
                name: `${mode === "demo" ? t("accounts.modeDemo", lang) : t("accounts.modeReal", lang)} ${t(plan.title, lang)}`,
                is_active: true
            })
            toast.success(t("accounts.createdWithPlan", lang).replace("{plan}", t(plan.title, lang)))
            onClose()
        } catch (err) {
            console.error(err)
            toast.error(t("accounts.errors.createFailed", lang))
        } finally {
            setCreating(false)
        }
    }

    if (!shouldRender) return null

    return (
        <div className={`acm-overlay ${isVisible ? "is-open" : "is-closing"}`}>
            <div className="acm-backdrop" onClick={onClose} />
            <div className="acm-sheet">
                {/* Header */}
                <div className="acm-header">
                    <button onClick={onClose} className="acm-close-btn">
                        <X size={24} />
                    </button>
                    <h2 className="acm-title">{t("accounts.openAccount", lang)}</h2>
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
                                {t("accounts.modeReal", lang)}
                            </button>
                            <button
                                onClick={() => setMode("demo")}
                                className={`acm-tab ${mode === "demo" ? "active" : ""}`}
                            >
                                {t("accounts.modeDemo", lang)}
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
                                    <AccountTypeCard lang={lang} plan={plan} mode={mode} />
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
                                aria-label={t("accounts.scrollToType", lang).replace("{index}", String(i + 1))}
                                type="button"
                            />
                        ))}
                    </div>
                </div>

                {/* Footer */}
                <div className="acm-footer">
                    <button
                        onClick={handleCreate}
                        disabled={creating}
                        className="acm-submit-btn"
                    >
                        {creating ? t("accounts.creating", lang) : t("common.continue", lang)}
                    </button>
                </div>
            </div>
        </div>
    )
}
