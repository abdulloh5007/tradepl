import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, CircleCheck, RefreshCw, Trophy, Wallet2, X } from "lucide-react"
import { toast } from "sonner"
import type { ProfitRewardStageStatus, ProfitRewardStatus } from "../../api"
import type { TradingAccount } from "../../types"
import { formatNumber } from "../../utils/format"
import SmartDropdown from "../../components/ui/SmartDropdown"
import "../../components/accounts/SharedAccountSheet.css"
import "./ProfitStagesPage.css"

interface ProfitStagesPageProps {
  status: ProfitRewardStatus | null
  accounts: TradingAccount[]
  onBack: () => void
  onRefresh: () => Promise<void> | void
  onClaim: (stageNo: number, tradingAccountID: string) => Promise<void>
}

const toNumber = (value?: string) => {
  const n = Number(value || 0)
  return Number.isFinite(n) ? n : 0
}

const stageStateLabel = (stage: ProfitRewardStageStatus) => {
  if (stage.claimed) return "Claimed"
  if (stage.can_claim) return "Ready to claim"
  if (stage.achieved) return "Passed"
  return "In progress"
}

export default function ProfitStagesPage({ status, accounts, onBack, onRefresh, onClaim }: ProfitStagesPageProps) {
  const [claimStageNo, setClaimStageNo] = useState<number | null>(null)
  const [claimAccountID, setClaimAccountID] = useState("")
  const [claiming, setClaiming] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const realAccounts = useMemo(
    () => accounts.filter(acc => acc.mode === "real"),
    [accounts]
  )

  const accountOptions = useMemo(
    () => realAccounts.map(acc => ({
      value: acc.id,
      label: `${acc.name} · ${acc.plan?.name || acc.plan_id}`,
    })),
    [realAccounts]
  )

  useEffect(() => {
    if (!claimAccountID && realAccounts.length > 0) {
      const active = realAccounts.find(acc => acc.is_active) || realAccounts[0]
      setClaimAccountID(active.id)
    }
  }, [claimAccountID, realAccounts])

  const progress = toNumber(status?.progress_usd)
  const nextStage = useMemo(
    () => status?.stages.find(stage => !stage.claimed) || null,
    [status]
  )

  const openClaim = (stageNo: number) => {
    if (realAccounts.length === 0) {
      toast.error("Create a real account first")
      return
    }
    setClaimStageNo(stageNo)
  }

  const claimTarget = claimStageNo
    ? status?.stages.find(stage => stage.stage_no === claimStageNo) || null
    : null

  return (
    <div className="profit-stage-page">
      <header className="profit-stage-header">
        <button type="button" className="profit-stage-icon-btn" onClick={onBack} aria-label="Back to profile">
          <ArrowLeft size={18} />
        </button>
        <h2>Profit Stages</h2>
        <button
          type="button"
          className="profit-stage-icon-btn"
          onClick={async () => {
            if (refreshing) return
            setRefreshing(true)
            try {
              await onRefresh()
            } finally {
              setRefreshing(false)
            }
          }}
          aria-label="Refresh stages"
        >
          <RefreshCw size={18} className={refreshing ? "spin" : ""} />
        </button>
      </header>

      <section className="profit-stage-summary">
        <div className="profit-stage-badge">
          <Trophy size={14} />
          <span>Net Closed Profit</span>
        </div>
        <div className="profit-stage-progress">${formatNumber(progress, 2, 2)}</div>
        <div className="profit-stage-meta">
          <span>{status?.claimed_stages || 0}/{status?.total_stages || 5} claimed</span>
          <span>{status?.available_claims || 0} ready</span>
        </div>
        {nextStage ? (
          <div className="profit-stage-next">
            Next: Stage {nextStage.stage_no} at ${formatNumber(toNumber(nextStage.target_profit_usd), 2, 2)}
          </div>
        ) : (
          <div className="profit-stage-next">All stages completed</div>
        )}
      </section>

      <section className="profit-stage-list">
        {(status?.stages || []).map(stage => {
          const target = toNumber(stage.target_profit_usd)
          const reward = toNumber(stage.reward_usd)
          const percent = target > 0 ? Math.max(0, Math.min(100, (progress / target) * 100)) : 0
          return (
            <article key={stage.stage_no} className={`profit-stage-item ${stage.claimed ? "claimed" : stage.can_claim ? "ready" : ""}`}>
              <div className="profit-stage-item-head">
                <strong>Stage {stage.stage_no}</strong>
                <span>{stageStateLabel(stage)}</span>
              </div>
              <div className="profit-stage-values">
                <span>Target ${formatNumber(target, 2, 2)}</span>
                <span>Reward +${formatNumber(reward, 2, 2)}</span>
              </div>
              <div className="profit-stage-bar">
                <div className="profit-stage-bar-fill" style={{ width: `${percent}%` }} />
              </div>
              <button
                type="button"
                className="profit-stage-claim-btn"
                disabled={stage.claimed || !stage.can_claim}
                onClick={() => openClaim(stage.stage_no)}
              >
                {stage.claimed ? (
                  <>
                    <CircleCheck size={14} />
                    Claimed
                  </>
                ) : stage.can_claim ? "Claim" : "Locked"}
              </button>
            </article>
          )
        })}
      </section>

      {claimTarget ? (
        <div className="acm-overlay" role="dialog" aria-modal="true">
          <div className="acm-backdrop" onClick={() => (!claiming ? setClaimStageNo(null) : null)} />
          <div className="acm-sheet">
            <div className="acm-header">
              <button
                type="button"
                className="acm-close-btn"
                onClick={() => setClaimStageNo(null)}
                disabled={claiming}
              >
                <X size={24} />
              </button>
              <h2 className="acm-title">Claim Stage {claimTarget.stage_no}</h2>
              <div className="acm-spacer" />
            </div>
            <div className="acm-content">
              <div className="acm-form">
                <div className="profit-stage-modal-amount">
                  <Wallet2 size={16} />
                  <span>Reward +${formatNumber(toNumber(claimTarget.reward_usd), 2, 2)}</span>
                </div>
                <label className="acm-label">
                  Credit to real account
                  <SmartDropdown
                    value={claimAccountID}
                    options={accountOptions}
                    onChange={(value) => setClaimAccountID(String(value))}
                    className="acm-dropdown"
                    ariaLabel="Select real account"
                    disabled={claiming || accountOptions.length === 0}
                  />
                </label>
                <button
                  type="button"
                  className="acm-submit-btn"
                  disabled={claiming || !claimAccountID}
                  onClick={async () => {
                    if (!claimAccountID) {
                      toast.error("Select real account")
                      return
                    }
                    setClaiming(true)
                    try {
                      await onClaim(claimTarget.stage_no, claimAccountID)
                      toast.success(`Stage ${claimTarget.stage_no} reward credited`)
                      setClaimStageNo(null)
                      await onRefresh()
                    } catch (err: any) {
                      toast.error(err?.message || "Failed to claim reward")
                    } finally {
                      setClaiming(false)
                    }
                  }}
                >
                  {claiming ? "Claiming..." : "Claim reward"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
