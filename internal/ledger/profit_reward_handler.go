package ledger

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
	"lv-tradepl/internal/httputil"
	"lv-tradepl/internal/types"
)

type profitRewardStageConfig struct {
	StageNo int
	Target  decimal.Decimal
	Reward  decimal.Decimal
}

var profitRewardStages = []profitRewardStageConfig{
	{StageNo: 1, Target: decimal.NewFromInt(200), Reward: decimal.NewFromInt(10)},
	{StageNo: 2, Target: decimal.NewFromInt(1000), Reward: decimal.NewFromInt(30)},
	{StageNo: 3, Target: decimal.NewFromInt(5000), Reward: decimal.NewFromInt(80)},
	{StageNo: 4, Target: decimal.NewFromInt(20000), Reward: decimal.NewFromInt(150)},
	{StageNo: 5, Target: decimal.NewFromInt(100000), Reward: decimal.NewFromInt(200)},
}

type profitRewardStageStatus struct {
	StageNo          int        `json:"stage_no"`
	TargetProfitUSD  string     `json:"target_profit_usd"`
	RewardUSD        string     `json:"reward_usd"`
	Achieved         bool       `json:"achieved"`
	Claimed          bool       `json:"claimed"`
	CanClaim         bool       `json:"can_claim"`
	ClaimedAt        *time.Time `json:"claimed_at,omitempty"`
	ClaimedAccountID string     `json:"claimed_account_id,omitempty"`
}

type profitRewardStatusResponse struct {
	Track           string                    `json:"track"`
	Currency        string                    `json:"currency"`
	ProgressUSD     string                    `json:"progress_usd"`
	TotalStages     int                       `json:"total_stages"`
	ClaimedStages   int                       `json:"claimed_stages"`
	AvailableClaims int                       `json:"available_claims"`
	Stages          []profitRewardStageStatus `json:"stages"`
}

type profitRewardClaimRequest struct {
	StageNo          int    `json:"stage_no"`
	TradingAccountID string `json:"trading_account_id"`
}

type profitRewardClaimResponse struct {
	Status           string    `json:"status"`
	StageNo          int       `json:"stage_no"`
	RewardUSD        string    `json:"reward_usd"`
	TradingAccountID string    `json:"trading_account_id"`
	ClaimedAt        time.Time `json:"claimed_at"`
	ProgressUSD      string    `json:"progress_usd"`
}

type profitRewardClaimRecord struct {
	StageNo          int
	ClaimedAt        time.Time
	TradingAccountID string
}

type pgQuery interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func (h *Handler) ProfitRewardStatus(w http.ResponseWriter, r *http.Request, userID string) {
	progress, claims, err := h.loadProfitRewardProgressAndClaims(r.Context(), h.svc.pool, userID)
	if err != nil {
		if isUndefinedTableError(err) || isUndefinedColumnError(err) {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "profit reward is unavailable: run migrations"})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	httputil.WriteJSON(w, http.StatusOK, buildProfitRewardStatusResponse(progress, claims))
}

func (h *Handler) ClaimProfitReward(w http.ResponseWriter, r *http.Request, userID string) {
	var req profitRewardClaimRequest
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	stageCfg, ok := profitRewardStageByNo(req.StageNo)
	if !ok {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid stage_no"})
		return
	}
	accountID := strings.TrimSpace(req.TradingAccountID)
	if accountID == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "trading_account_id is required"})
		return
	}

	tx, err := h.svc.pool.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	defer tx.Rollback(r.Context())

	progress, claims, err := h.loadProfitRewardProgressAndClaims(r.Context(), tx, userID)
	if err != nil {
		if isUndefinedTableError(err) || isUndefinedColumnError(err) {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "profit reward is unavailable: run migrations"})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	if _, exists := claims[req.StageNo]; exists {
		httputil.WriteJSON(w, http.StatusConflict, httputil.ErrorResponse{Error: "stage already claimed"})
		return
	}
	if progress.LessThan(stageCfg.Target) {
		httputil.WriteJSON(w, http.StatusConflict, httputil.ErrorResponse{Error: "stage target is not reached yet"})
		return
	}

	var targetAccountName string
	err = tx.QueryRow(r.Context(), `
		SELECT name
		FROM trading_accounts
		WHERE id = $1
		  AND user_id = $2
		  AND mode = 'real'
		FOR UPDATE
	`, accountID, userID).Scan(&targetAccountName)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "target trading account must be a real account of current user"})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	var usdAssetID string
	if err := tx.QueryRow(r.Context(), `SELECT id::text FROM assets WHERE symbol = 'USD'`).Scan(&usdAssetID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "USD asset not found"})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	systemAccount, err := h.svc.EnsureSystemAccount(r.Context(), tx, usdAssetID, types.AccountKindAvailable)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	userAccount, err := h.svc.EnsureAccountForTradingAccount(r.Context(), tx, userID, accountID, usdAssetID, types.AccountKindAvailable)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	ref := fmt.Sprintf("profit_reward:%s:stage:%d:%s", userID, stageCfg.StageNo, accountID)
	ledgerTxID, err := h.svc.Transfer(r.Context(), tx, systemAccount, userAccount, stageCfg.Reward, types.LedgerEntryTypeDeposit, ref)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	var claimedAt time.Time
	err = tx.QueryRow(r.Context(), `
		INSERT INTO profit_reward_claims (
			user_id,
			stage_no,
			target_trading_account_id,
			threshold_usd,
			reward_usd,
			progress_snapshot_usd,
			ledger_tx_id,
			claimed_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
		RETURNING claimed_at
	`, userID, stageCfg.StageNo, accountID, stageCfg.Target, stageCfg.Reward, progress, ledgerTxID).Scan(&claimedAt)
	if err != nil {
		if isUniqueViolationError(err) {
			httputil.WriteJSON(w, http.StatusConflict, httputil.ErrorResponse{Error: "stage already claimed"})
			return
		}
		if isUndefinedTableError(err) || isUndefinedColumnError(err) {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "profit reward is unavailable: run migrations"})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	h.notifyUserTelegramAsync(
		userID,
		"bonus",
		"Profit stage reward credited",
		fmt.Sprintf("Stage %d reward %s USD credited to account %s.", stageCfg.StageNo, stageCfg.Reward.StringFixed(2), targetAccountName),
		"#history",
	)

	httputil.WriteJSON(w, http.StatusOK, profitRewardClaimResponse{
		Status:           "claimed",
		StageNo:          stageCfg.StageNo,
		RewardUSD:        stageCfg.Reward.StringFixed(2),
		TradingAccountID: accountID,
		ClaimedAt:        claimedAt,
		ProgressUSD:      progress.StringFixed(2),
	})
}

func buildProfitRewardStatusResponse(progress decimal.Decimal, claims map[int]profitRewardClaimRecord) profitRewardStatusResponse {
	stages := make([]profitRewardStageStatus, 0, len(profitRewardStages))
	claimedStages := 0
	availableClaims := 0

	for _, cfg := range profitRewardStages {
		claim, claimed := claims[cfg.StageNo]
		achieved := progress.GreaterThanOrEqual(cfg.Target)
		canClaim := achieved && !claimed
		if claimed {
			claimedStages++
		}
		if canClaim {
			availableClaims++
		}
		stage := profitRewardStageStatus{
			StageNo:         cfg.StageNo,
			TargetProfitUSD: cfg.Target.StringFixed(2),
			RewardUSD:       cfg.Reward.StringFixed(2),
			Achieved:        achieved,
			Claimed:         claimed,
			CanClaim:        canClaim,
		}
		if claimed {
			claimedAt := claim.ClaimedAt
			stage.ClaimedAt = &claimedAt
			stage.ClaimedAccountID = claim.TradingAccountID
		}
		stages = append(stages, stage)
	}

	return profitRewardStatusResponse{
		Track:           "net_closed_profit",
		Currency:        "USD",
		ProgressUSD:     progress.StringFixed(2),
		TotalStages:     len(profitRewardStages),
		ClaimedStages:   claimedStages,
		AvailableClaims: availableClaims,
		Stages:          stages,
	}
}

func (h *Handler) loadProfitRewardProgressAndClaims(ctx context.Context, q pgQuery, userID string) (decimal.Decimal, map[int]profitRewardClaimRecord, error) {
	progress, err := h.loadProfitRewardProgress(ctx, q, userID)
	if err != nil {
		return decimal.Zero, nil, err
	}
	claims, err := h.loadProfitRewardClaims(ctx, q, userID)
	if err != nil {
		return decimal.Zero, nil, err
	}
	return progress, claims, nil
}

func (h *Handler) loadProfitRewardProgress(ctx context.Context, q pgQuery, userID string) (decimal.Decimal, error) {
	var progress decimal.Decimal
	err := q.QueryRow(ctx, `
		SELECT COALESCE(SUM(
			CASE
				WHEN (COALESCE(o.realized_pnl, 0) + COALESCE(o.realized_swap, 0)) > 0
				THEN (COALESCE(o.realized_pnl, 0) + COALESCE(o.realized_swap, 0))
				ELSE 0
			END
		), 0)
		FROM orders o
		JOIN trading_accounts ta ON ta.id = o.trading_account_id
		WHERE o.user_id = $1
		  AND ta.mode = 'real'
		  AND o.status = 'closed'
	`, userID).Scan(&progress)
	if err != nil {
		return decimal.Zero, err
	}
	if progress.LessThan(decimal.Zero) {
		return decimal.Zero, nil
	}
	return progress.Round(2), nil
}

func (h *Handler) loadProfitRewardClaims(ctx context.Context, q pgQuery, userID string) (map[int]profitRewardClaimRecord, error) {
	rows, err := q.Query(ctx, `
		SELECT stage_no, target_trading_account_id::text, claimed_at
		FROM profit_reward_claims
		WHERE user_id = $1
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	claims := make(map[int]profitRewardClaimRecord, len(profitRewardStages))
	for rows.Next() {
		var rec profitRewardClaimRecord
		if err := rows.Scan(&rec.StageNo, &rec.TradingAccountID, &rec.ClaimedAt); err != nil {
			return nil, err
		}
		claims[rec.StageNo] = rec
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return claims, nil
}

func profitRewardStageByNo(stageNo int) (profitRewardStageConfig, bool) {
	for _, cfg := range profitRewardStages {
		if cfg.StageNo == stageNo {
			return cfg, true
		}
	}
	return profitRewardStageConfig{}, false
}
