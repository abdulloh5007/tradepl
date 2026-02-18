package ledger

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
	"lv-tradepl/internal/httputil"
	"lv-tradepl/internal/types"
)

type referralStatusResponse struct {
	ReferralCode             string                        `json:"referral_code"`
	ShareURL                 string                        `json:"share_url"`
	Balance                  string                        `json:"balance"`
	TotalEarned              string                        `json:"total_earned"`
	TotalWithdrawn           string                        `json:"total_withdrawn"`
	ReferralsTotal           int                           `json:"referrals_total"`
	ReferredUsers            []referralReferredUserPreview `json:"referred_users"`
	SignupRewardUSD          string                        `json:"signup_reward_usd"`
	DepositCommissionPercent string                        `json:"deposit_commission_percent"`
	MinWithdrawUSD           string                        `json:"min_withdraw_usd"`
	CanWithdraw              bool                          `json:"can_withdraw"`
	RealAccountRequired      bool                          `json:"real_account_required"`
}

type referralReferredUserPreview struct {
	UserID                string `json:"user_id"`
	DisplayName           string `json:"display_name"`
	AvatarURL             string `json:"avatar_url,omitempty"`
	TelegramID            int64  `json:"telegram_id,omitempty"`
	DepositVolumeUSD      string `json:"deposit_volume_usd"`
	DepositCommissionUSD  string `json:"deposit_commission_usd"`
	DepositCommissionRuns int    `json:"deposit_commission_runs"`
}

type referralEventsResponse struct {
	Items []referralEventItem `json:"items"`
}

type referralWithdrawRequest struct {
	AmountUSD string `json:"amount_usd"`
}

type referralWithdrawResponse struct {
	Status    string `json:"status"`
	AmountUSD string `json:"amount_usd"`
	Balance   string `json:"balance"`
}

func (h *Handler) ReferralStatus(w http.ResponseWriter, r *http.Request, userID string) {
	if h.accountSvc == nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "account service unavailable"})
		return
	}
	if err := h.accountSvc.EnsureDefaultAccounts(r.Context(), userID); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	code, err := h.ensureUserReferralCode(r.Context(), userID)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	wallet, err := h.readReferralWallet(r.Context(), userID)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	var totalRefs int
	if err := h.svc.pool.QueryRow(r.Context(), `SELECT COUNT(*) FROM users WHERE referred_by = $1`, userID).Scan(&totalRefs); err != nil {
		if !isUndefinedColumnError(err) {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
			return
		}
	}

	var realAccounts int
	if err := h.svc.pool.QueryRow(r.Context(), `SELECT COUNT(*) FROM trading_accounts WHERE user_id = $1 AND mode = 'real'`, userID).Scan(&realAccounts); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	hasReal := realAccounts > 0
	canWithdraw := wallet.Balance.GreaterThanOrEqual(referralWithdrawMinUSD) && hasReal
	referredUsers := make([]referralReferredUserPreview, 0)
	rows, rowsErr := h.svc.pool.Query(r.Context(), `
		SELECT
			u.id::text,
			COALESCE(NULLIF(TRIM(u.display_name), ''), NULLIF(SPLIT_PART(COALESCE(u.email, ''), '@', 1), ''), 'User'),
			COALESCE(NULLIF(TRIM(u.avatar_url), ''), ''),
			COALESCE(u.telegram_id, 0)
		FROM users u
		WHERE u.referred_by = $1
		ORDER BY COALESCE(u.referred_at, u.created_at) DESC, u.created_at DESC
		LIMIT 300
	`, userID)
	if rowsErr == nil {
		defer rows.Close()
		for rows.Next() {
			var item referralReferredUserPreview
			if scanErr := rows.Scan(&item.UserID, &item.DisplayName, &item.AvatarURL, &item.TelegramID); scanErr != nil {
				httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: scanErr.Error()})
				return
			}
			item.DisplayName = strings.TrimSpace(item.DisplayName)
			if item.DisplayName == "" {
				item.DisplayName = "User"
			}
			item.DepositVolumeUSD = "0.00"
			item.DepositCommissionUSD = "0.00"
			item.DepositCommissionRuns = 0
			referredUsers = append(referredUsers, item)
		}
		if iterErr := rows.Err(); iterErr != nil {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: iterErr.Error()})
			return
		}

		if len(referredUsers) > 0 {
			userIndex := make(map[string]int, len(referredUsers))
			for i := range referredUsers {
				id := strings.TrimSpace(referredUsers[i].UserID)
				if id != "" {
					userIndex[id] = i
				}
			}

			aggRows, aggErr := h.svc.pool.Query(r.Context(), `
				SELECT
					COALESCE(related_user_id::text, '') AS related_user_id,
					COALESCE(SUM(amount), 0) AS commission_usd,
					COALESCE(SUM(
						CASE
							WHEN COALESCE(commission_percent, 0) > 0
								THEN amount * 100 / commission_percent
							ELSE 0
						END
					), 0) AS deposit_volume_usd,
					COUNT(*) AS runs
				FROM referral_events
				WHERE user_id = $1
				  AND kind = 'deposit_commission'
				GROUP BY related_user_id
			`, userID)
			if aggErr == nil {
				defer aggRows.Close()
				for aggRows.Next() {
					var relatedUserID string
					var commissionUSD decimal.Decimal
					var depositVolumeUSD decimal.Decimal
					var runs int
					if scanErr := aggRows.Scan(&relatedUserID, &commissionUSD, &depositVolumeUSD, &runs); scanErr != nil {
						httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: scanErr.Error()})
						return
					}
					idx, ok := userIndex[strings.TrimSpace(relatedUserID)]
					if !ok {
						continue
					}
					referredUsers[idx].DepositCommissionUSD = commissionUSD.Round(2).StringFixed(2)
					referredUsers[idx].DepositVolumeUSD = depositVolumeUSD.Round(2).StringFixed(2)
					referredUsers[idx].DepositCommissionRuns = runs
				}
				if iterErr := aggRows.Err(); iterErr != nil {
					httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: iterErr.Error()})
					return
				}
			} else if !isUndefinedColumnError(aggErr) && !isUndefinedTableError(aggErr) {
				httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: aggErr.Error()})
				return
			}
		}
	} else if !isUndefinedColumnError(rowsErr) && !isUndefinedTableError(rowsErr) {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: rowsErr.Error()})
		return
	}

	httputil.WriteJSON(w, http.StatusOK, referralStatusResponse{
		ReferralCode:             code,
		ShareURL:                 h.telegramReferralDeepLink(r.Context(), code),
		Balance:                  wallet.Balance.StringFixed(2),
		TotalEarned:              wallet.TotalEarned.StringFixed(2),
		TotalWithdrawn:           wallet.TotalWithdraw.StringFixed(2),
		ReferralsTotal:           totalRefs,
		ReferredUsers:            referredUsers,
		SignupRewardUSD:          referralSignupRewardUSD.StringFixed(2),
		DepositCommissionPercent: referralDepositCommissionPercent.StringFixed(2),
		MinWithdrawUSD:           referralWithdrawMinUSD.StringFixed(2),
		CanWithdraw:              canWithdraw,
		RealAccountRequired:      !hasReal,
	})
}

func (h *Handler) ReferralEvents(w http.ResponseWriter, r *http.Request, userID string) {
	limit := 30
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			if parsed > 200 {
				parsed = 200
			}
			limit = parsed
		}
	}
	var before *time.Time
	if raw := strings.TrimSpace(r.URL.Query().Get("before")); raw != "" {
		if parsed, err := time.Parse(time.RFC3339, raw); err == nil {
			t := parsed.UTC()
			before = &t
		}
	}

	rows, err := h.svc.pool.Query(r.Context(), `
		SELECT
			id::text,
			kind,
			amount,
			commission_percent,
			COALESCE(related_user_id::text, ''),
			COALESCE(trading_account_id::text, ''),
			created_at
		FROM referral_events
		WHERE user_id = $1
		  AND ($2::timestamptz IS NULL OR created_at < $2)
		ORDER BY created_at DESC, id DESC
		LIMIT $3
	`, userID, before, limit)
	if err != nil {
		if isUndefinedTableError(err) || isUndefinedColumnError(err) {
			httputil.WriteJSON(w, http.StatusOK, referralEventsResponse{Items: []referralEventItem{}})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	defer rows.Close()

	items := make([]referralEventItem, 0, limit)
	for rows.Next() {
		var it referralEventItem
		var createdAt time.Time
		if err := rows.Scan(
			&it.ID,
			&it.Kind,
			&it.Amount,
			&it.CommissionPercent,
			&it.RelatedUserID,
			&it.TradingAccountID,
			&createdAt,
		); err != nil {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
			return
		}
		it.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	httputil.WriteJSON(w, http.StatusOK, referralEventsResponse{Items: items})
}

func (h *Handler) ReferralWithdraw(w http.ResponseWriter, r *http.Request, userID string) {
	if h.accountSvc == nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "account service unavailable"})
		return
	}
	account, err := h.accountSvc.Resolve(r.Context(), userID, strings.TrimSpace(r.Header.Get("X-Account-ID")))
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if account == nil || account.Mode != "real" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "referral withdraw is allowed only to real account"})
		return
	}

	var req referralWithdrawRequest
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	tx, err := h.svc.pool.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	defer tx.Rollback(r.Context())

	if err := h.ensureReferralWalletTx(r.Context(), tx, userID); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	var currentBalance decimal.Decimal
	if err := tx.QueryRow(r.Context(), `
		SELECT COALESCE(balance, 0)
		FROM referral_wallets
		WHERE user_id = $1
		FOR UPDATE
	`, userID).Scan(&currentBalance); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "referral balance is empty"})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	if currentBalance.LessThan(referralWithdrawMinUSD) {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "minimum referral balance for withdraw is 30 USD"})
		return
	}

	amount := currentBalance
	if strings.TrimSpace(req.AmountUSD) != "" {
		parsed, parseErr := decimal.NewFromString(strings.TrimSpace(req.AmountUSD))
		if parseErr != nil || !parsed.GreaterThan(decimal.Zero) {
			httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid amount_usd"})
			return
		}
		amount = parsed.Round(2)
	}
	if amount.LessThan(referralWithdrawMinUSD) {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "withdraw amount must be at least 30 USD"})
		return
	}
	if amount.GreaterThan(currentBalance) {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "insufficient referral balance"})
		return
	}

	if err := h.debitReferralWalletTx(r.Context(), tx, userID, amount); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	usdAsset, err := h.store.GetAssetBySymbol(r.Context(), "USD")
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "USD asset not found"})
		return
	}
	systemAccount, err := h.svc.EnsureSystemAccount(r.Context(), tx, usdAsset.ID, types.AccountKindAvailable)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	userAvailable, err := h.svc.EnsureAccountForTradingAccount(r.Context(), tx, userID, account.ID, usdAsset.ID, types.AccountKindAvailable)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	sourceRef := fmt.Sprintf("referral_withdraw:%s:%d", userID, time.Now().UTC().UnixNano())
	ledgerTxID, err := h.svc.Transfer(r.Context(), tx, systemAccount, userAvailable, amount, types.LedgerEntryTypeDeposit, sourceRef)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	_, err = tx.Exec(r.Context(), `
		INSERT INTO referral_events (
			user_id,
			related_user_id,
			trading_account_id,
			kind,
			amount,
			commission_percent,
			source_ref,
			ledger_tx_id,
			created_at
		)
		VALUES ($1, NULL, $2, 'withdrawal', $3, 0, $4, $5::uuid, NOW())
	`, userID, account.ID, amount, sourceRef, ledgerTxID)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	var nextBalance decimal.Decimal
	if err := tx.QueryRow(r.Context(), `
		SELECT COALESCE(balance, 0)
		FROM referral_wallets
		WHERE user_id = $1
	`, userID).Scan(&nextBalance); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	h.notifyUserTelegramAsync(
		userID,
		"referral",
		"Referral withdrawal completed",
		fmt.Sprintf("%s USD was transferred from referral balance to your real account.", amount.StringFixed(2)),
		"#history",
	)

	httputil.WriteJSON(w, http.StatusOK, referralWithdrawResponse{
		Status:    "ok",
		AmountUSD: amount.StringFixed(2),
		Balance:   nextBalance.StringFixed(2),
	})
}

func (h *Handler) ensureUserReferralCode(ctx context.Context, userID string) (string, error) {
	var code string
	err := h.svc.pool.QueryRow(ctx, `
		SELECT COALESCE(referral_code, '')
		FROM users
		WHERE id = $1
	`, userID).Scan(&code)
	if err != nil {
		if isUndefinedColumnError(err) {
			return "", errors.New("referral is unavailable: run migrations")
		}
		return "", err
	}
	code = strings.TrimSpace(code)
	if code != "" {
		return code, nil
	}
	code = referralCodeFromUserID(userID)
	if code == "" {
		return "", errors.New("failed to build referral code")
	}
	_, err = h.svc.pool.Exec(ctx, `
		UPDATE users
		SET referral_code = $2
		WHERE id = $1
		  AND COALESCE(TRIM(referral_code), '') = ''
	`, userID, code)
	if err != nil {
		return "", err
	}
	return code, nil
}
