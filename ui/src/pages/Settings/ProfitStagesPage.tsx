import { useEffect, useMemo, useState } from "react"
import { CircleCheck, RefreshCw, Trophy, Wallet2, X } from "lucide-react"
import { toast } from "sonner"
import type { ProfitRewardStageStatus, ProfitRewardStatus } from "../../api"
import type { Lang, TradingAccount } from "../../types"
import { formatNumber } from "../../utils/format"
import { t } from "../../utils/i18n"
import SmartDropdown from "../../components/ui/SmartDropdown"
import TelegramBackButton from "../../components/telegram/TelegramBackButton"
import { useAnimatedPresence } from "../../hooks/useAnimatedPresence"
import "../../components/accounts/SharedAccountSheet.css"
import "./ProfitStagesPage.css"

interface ProfitStagesPageProps {
  lang: Lang
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

const stageStateLabel = (stage: ProfitRewardStageStatus, lang: Lang) => {
  if (stage.claimed) return t("profitStages.claimed", lang)
  if (stage.can_claim) return t("profitStages.readyToClaim", lang)
  if (stage.achieved) return t("profitStages.passed", lang)
  return t("profitStages.inProgress", lang)
}

export default function ProfitStagesPage({ lang, status, accounts, onBack, onRefresh, onClaim }: ProfitStagesPageProps) {
  const [claimStageNo, setClaimStageNo] = useState<number | null>(null)
  const [claimTargetCache, setClaimTargetCache] = useState<ProfitRewardStageStatus | null>(null)
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
      toast.error(t("profile.createRealAccountFirst", lang))
      return
    }
    setClaimStageNo(stageNo)
  }

  const claimTarget = claimStageNo
    ? status?.stages.find(stage => stage.stage_no === claimStageNo) || null
    : null
  const { shouldRender: claimModalRender, isVisible: claimModalVisible } = useAnimatedPresence(Boolean(claimTarget), 220)
  const claimTargetForView = claimTarget || claimTargetCache

  useEffect(() => {
    if (claimTarget) {
      setClaimTargetCache(claimTarget)
    }
  }, [claimTarget])

  useEffect(() => {
    if (!claimModalRender) {
      setClaimTargetCache(null)
    }
  }, [claimModalRender])

  return (
    <div className="profit-stage-page app-page-top-offset">
      <TelegramBackButton onBack={onBack} showFallback={false} />

      <section className="profit-stage-summary">
        <div className="profit-stage-summary-top">
          <div className="profit-stage-badge">
            <Trophy size={14} />
            <span>{t("profitStages.netClosedProfit", lang)}</span>
          </div>
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
            aria-label={t("profitStages.refresh", lang)}
          >
            <RefreshCw size={18} className={refreshing ? "spin" : ""} />
          </button>
        </div>
        <div className="profit-stage-progress">${formatNumber(progress, 2, 2)}</div>
        <div className="profit-stage-meta">
          <span>{t("profitStages.claimedMeta", lang).replace("{claimed}", String(status?.claimed_stages || 0)).replace("{total}", String(status?.total_stages || 5))}</span>
          <span>{t("profitStages.readyMeta", lang).replace("{ready}", String(status?.available_claims || 0))}</span>
        </div>
        {nextStage ? (
          <div className="profit-stage-next">
            {t("profitStages.nextStage", lang)
              .replace("{stage}", String(nextStage.stage_no))
              .replace("{target}", formatNumber(toNumber(nextStage.target_profit_usd), 2, 2))}
          </div>
        ) : (
          <div className="profit-stage-next">{t("profitStages.allCompleted", lang)}</div>
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
                <strong>{t("profitStages.stage", lang)} {stage.stage_no}</strong>
                <span>{stageStateLabel(stage, lang)}</span>
              </div>
              <div className="profit-stage-values">
                <span>{t("profitStages.target", lang)} ${formatNumber(target, 2, 2)}</span>
                <span>{t("profitStages.reward", lang)} +${formatNumber(reward, 2, 2)}</span>
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
                    {t("profitStages.claimed", lang)}
                  </>
                ) : stage.can_claim ? t("profitStages.claim", lang) : t("profitStages.locked", lang)}
              </button>
            </article>
          )
        })}
      </section>

      {claimModalRender && claimTargetForView ? (
        <div className={`acm-overlay ${claimModalVisible ? "is-open" : "is-closing"}`} role="dialog" aria-modal="true">
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
              <h2 className="acm-title">{t("profitStages.claimStage", lang).replace("{stage}", String(claimTargetForView.stage_no))}</h2>
              <div className="acm-spacer" />
            </div>
            <div className="acm-content">
              <div className="acm-form">
                <div className="profit-stage-modal-amount">
                  <Wallet2 size={16} />
                  <span>{t("profitStages.reward", lang)} +${formatNumber(toNumber(claimTargetForView.reward_usd), 2, 2)}</span>
                </div>
                <label className="acm-label">
                  {t("profitStages.creditToRealAccount", lang)}
                  <SmartDropdown
                    value={claimAccountID}
                    options={accountOptions}
                    onChange={(value) => setClaimAccountID(String(value))}
                    className="acm-dropdown"
                    ariaLabel={t("profitStages.selectRealAccount", lang)}
                    disabled={claiming || accountOptions.length === 0}
                  />
                </label>
                <button
                  type="button"
                  className="acm-submit-btn"
                  disabled={claiming || !claimAccountID}
                  onClick={async () => {
                    if (!claimAccountID) {
                      toast.error(t("profitStages.selectRealAccount", lang))
                      return
                    }
                    setClaiming(true)
                    try {
                      await onClaim(claimTargetForView.stage_no, claimAccountID)
                      toast.success(t("profitStages.rewardCredited", lang).replace("{stage}", String(claimTargetForView.stage_no)))
                      setClaimStageNo(null)
                      await onRefresh()
                    } catch (err: any) {
                      toast.error(err?.message || t("profitStages.claimFailed", lang))
                    } finally {
                      setClaiming(false)
                    }
                  }}
                >
                  {claiming ? t("accounts.claiming", lang) : t("profitStages.claimReward", lang)}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
