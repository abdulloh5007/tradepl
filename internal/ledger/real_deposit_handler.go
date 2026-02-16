package ledger

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/shopspring/decimal"
	"lv-tradepl/internal/depositmethods"
	"lv-tradepl/internal/httputil"
	"lv-tradepl/internal/types"
)

const maxRealDepositProofBytes = 5 * 1024 * 1024

type realDepositRequestInput struct {
	AmountUSD   string `json:"amount_usd"`
	VoucherKind string `json:"voucher_kind"`
	MethodID    string `json:"method_id"`
	ProofName   string `json:"proof_file_name"`
	ProofMime   string `json:"proof_mime_type"`
	ProofBase64 string `json:"proof_base64"`
}

type realDepositRequestResponse struct {
	RequestID      string    `json:"request_id"`
	Ticket         string    `json:"ticket"`
	Status         string    `json:"status"`
	ReviewDueAt    time.Time `json:"review_due_at"`
	AmountUSD      string    `json:"amount_usd"`
	BonusAmountUSD string    `json:"bonus_amount_usd"`
	TotalCreditUSD string    `json:"total_credit_usd"`
	VoucherKind    string    `json:"voucher_kind"`
	MethodID       string    `json:"method_id"`
}

type dueDepositRequest struct {
	TicketNo         int64
	ID               string
	UserID           string
	TradingAccountID string
	AmountUSD        decimal.Decimal
	VoucherKind      string
	BonusAmountUSD   decimal.Decimal
}

func (h *Handler) DepositBonusStatus(w http.ResponseWriter, r *http.Request, userID string) {
	if h.accountSvc == nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "account service unavailable"})
		return
	}
	if err := h.accountSvc.EnsureDefaultAccounts(r.Context(), userID); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	cfg, err := h.loadBonusProgramConfig(r.Context())
	if err != nil {
		if isUndefinedTableError(err) {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "deposit bonus is unavailable: run migrations"})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	eligibleAccountID, resolveErr := h.resolvePreferredRealAccountID(r.Context(), userID, strings.TrimSpace(r.Header.Get("X-Account-ID")))
	if resolveErr != nil && !errors.Is(resolveErr, pgx.ErrNoRows) {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: resolveErr.Error()})
		return
	}

	usedVouchers, err := h.loadUsedDepositVoucherMap(r.Context(), userID)
	if err != nil {
		if isUndefinedTableError(err) {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "deposit bonus is unavailable: run migrations"})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	goldUsed := usedVouchers["gold"]
	diamondUsed := usedVouchers["diamond"]
	allVouchersUsed := goldUsed && diamondUsed

	var pendingCount int
	var nextDue *time.Time
	var nextDueRaw pgtype.Timestamptz
	err = h.svc.pool.QueryRow(r.Context(), `
		SELECT COUNT(*), MIN(review_due_at)
		FROM real_deposit_requests
		WHERE user_id = $1
		  AND status = 'pending'
	`, userID).Scan(&pendingCount, &nextDueRaw)
	if err != nil {
		if isUndefinedTableError(err) {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "deposit bonus is unavailable: run migrations"})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if nextDueRaw.Valid {
		t := nextDueRaw.Time.UTC()
		nextDue = &t
	}

	available := strings.TrimSpace(eligibleAccountID) != ""
	paymentMethods, methodsErr := depositmethods.Load(r.Context(), h.svc.pool)
	if methodsErr != nil {
		paymentMethods = depositmethods.Defaults()
	}
	resp := depositBonusStatusResponse{
		MinAmountUSD:      cfg.RealDepositMinUSD.StringFixed(2),
		MaxAmountUSD:      cfg.RealDepositMaxUSD.StringFixed(2),
		USDToUZSRate:      cfg.USDToUZSRate.StringFixed(2),
		ReviewMinutes:     cfg.RealDepositReviewMinute,
		OneTimeUsed:       allVouchersUsed,
		PendingCount:      pendingCount,
		NextReviewDueAt:   nextDue,
		EligibleAccountID: eligibleAccountID,
		Vouchers: []depositVoucherStatus{
			{ID: "gold", Title: voucherTitle("gold"), Percent: "100", Available: available && !goldUsed, Used: goldUsed},
			{ID: "diamond", Title: voucherTitle("diamond"), Percent: "50", Available: available && !diamondUsed, Used: diamondUsed},
		},
		PaymentMethods: paymentMethods,
	}
	httputil.WriteJSON(w, http.StatusOK, resp)
}

func (h *Handler) RequestRealDeposit(w http.ResponseWriter, r *http.Request, userID string) {
	if h.accountSvc == nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "account service unavailable"})
		return
	}
	account, err := h.accountSvc.Resolve(r.Context(), userID, strings.TrimSpace(r.Header.Get("X-Account-ID")))
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if account.Mode != "real" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "real deposit request is allowed only for real account"})
		return
	}
	standardRealAccount := strings.TrimSpace(strings.ToLower(account.PlanID)) == "standard"

	var req realDepositRequestInput
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	amountUSD, err := decimal.NewFromString(strings.TrimSpace(req.AmountUSD))
	if err != nil || !amountUSD.GreaterThan(decimal.Zero) {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid amount_usd"})
		return
	}

	cfg, cfgErr := h.loadBonusProgramConfig(r.Context())
	if cfgErr != nil {
		if isUndefinedTableError(cfgErr) {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "deposit bonus is unavailable: run migrations"})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: cfgErr.Error()})
		return
	}
	if amountUSD.LessThan(cfg.RealDepositMinUSD) || amountUSD.GreaterThan(cfg.RealDepositMaxUSD) {
		msg := fmt.Sprintf("amount must be between %s and %s USD", cfg.RealDepositMinUSD.StringFixed(2), cfg.RealDepositMaxUSD.StringFixed(2))
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: msg})
		return
	}

	voucherKind := normalizeVoucherKind(req.VoucherKind)
	percent := voucherPercent(voucherKind)
	if !standardRealAccount {
		voucherKind = "none"
		percent = decimal.Zero
	}

	usedVouchers, err := h.loadUsedDepositVoucherMap(r.Context(), userID)
	if err != nil {
		if isUndefinedTableError(err) {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "deposit bonus is unavailable: run migrations"})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if voucherKind != "none" && usedVouchers[voucherKind] {
		voucherKind = "none"
		percent = decimal.Zero
	}
	if voucherKind != "none" {
		minVoucherAmount := voucherMinAmountUSD(voucherKind)
		if minVoucherAmount.GreaterThan(decimal.Zero) && amountUSD.LessThan(minVoucherAmount) {
			httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{
				Error: fmt.Sprintf("%s voucher requires minimum %s USD deposit", voucherKind, minVoucherAmount.StringFixed(2)),
			})
			return
		}
	}

	methodID := strings.ToLower(strings.TrimSpace(req.MethodID))
	if methodID == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "payment method is required"})
		return
	}
	methods, methodsErr := depositmethods.Load(r.Context(), h.svc.pool)
	if methodsErr != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: methodsErr.Error()})
		return
	}
	methodAvailable := false
	for _, item := range methods {
		if strings.EqualFold(item.ID, methodID) {
			methodAvailable = item.Enabled
			break
		}
	}
	if !methodAvailable {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "selected payment method is unavailable"})
		return
	}

	proofName := strings.TrimSpace(req.ProofName)
	proofMime := strings.TrimSpace(req.ProofMime)
	if proofName == "" || proofMime == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "proof file is required"})
		return
	}
	proofBlob, err := decodeProofBlob(req.ProofBase64)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if len(proofBlob) > maxRealDepositProofBytes {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "proof file is too large"})
		return
	}

	bonusAmount := amountUSD.Mul(percent).Div(decimal.NewFromInt(100))
	totalCredit := amountUSD.Add(bonusAmount)
	amountUZS := amountUSD.Mul(cfg.USDToUZSRate)
	reviewDue := time.Now().UTC().Add(time.Duration(cfg.RealDepositReviewMinute) * time.Minute)

	tx, err := h.svc.pool.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	defer tx.Rollback(r.Context())

	var requestID string
	var ticketNo int64
	err = tx.QueryRow(r.Context(), `
			INSERT INTO real_deposit_requests (
				user_id,
				trading_account_id,
				amount_usd,
				amount_uzs,
				voucher_kind,
				payment_method_id,
				bonus_percent,
				bonus_amount_usd,
				total_credit_usd,
				proof_file_name,
			proof_mime_type,
			proof_size_bytes,
			proof_blob,
			status,
			review_due_at,
			updated_at
			) VALUES (
				$1, $2, $3, $4,
				$5, $6, $7, $8, $9,
				$10, $11, $12, $13,
				'pending', $14, NOW()
			)
			RETURNING id::text, ticket_no
		`, userID, account.ID, amountUSD, amountUZS, voucherKind, methodID, percent, bonusAmount, totalCredit, proofName, proofMime, len(proofBlob), proofBlob, reviewDue).Scan(&requestID, &ticketNo)
	if err != nil {
		if isUndefinedTableError(err) || isUndefinedColumnError(err) {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "real deposits are unavailable: run migrations"})
			return
		}
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	enqueueReviewDispatchTx(r.Context(), tx, "deposit", requestID)
	if err := tx.Commit(r.Context()); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	ticket := formatRealDepositTicket(ticketNo, requestID)
	h.notifyUserTelegramAsync(
		userID,
		"Deposit request received",
		fmt.Sprintf("Request %s was sent for review. Amount: %s USD.", ticket, amountUSD.StringFixed(2)),
		"#notifications",
	)

	httputil.WriteJSON(w, http.StatusCreated, realDepositRequestResponse{
		RequestID:      requestID,
		Ticket:         ticket,
		Status:         "pending",
		ReviewDueAt:    reviewDue,
		AmountUSD:      amountUSD.StringFixed(2),
		BonusAmountUSD: bonusAmount.StringFixed(2),
		TotalCreditUSD: totalCredit.StringFixed(2),
		VoucherKind:    voucherKind,
		MethodID:       methodID,
	})
}

func (h *Handler) StartRealDepositApprovalWorker(ctx context.Context) {
	run := func() {
		cfg, cfgErr := h.loadBonusProgramConfig(ctx)
		if cfgErr != nil {
			if !isUndefinedTableError(cfgErr) {
				log.Printf("[deposit-review] failed to load config: %v", cfgErr)
			}
			_, _ = h.processDueRealDepositRequests(ctx, 20)
			return
		}

		chatID := strings.TrimSpace(cfg.TelegramDepositChatID)
		kycChatID := strings.TrimSpace(cfg.TelegramKYCChatID)
		hasTelegramBot := strings.TrimSpace(h.tgBotToken) != ""
		hasTelegramReviewConfig := hasTelegramBot && chatID != ""
		telegramRuntimeEnabled := h.telegramRuntimeEnabled() && hasTelegramBot
		useTelegramReview := telegramRuntimeEnabled && chatID != ""
		if telegramRuntimeEnabled {
			if _, err := h.processTelegramDepositCallbacks(ctx, chatID, kycChatID, 50); err != nil {
				log.Printf("[deposit-review] failed to process telegram updates: %v", err)
			}
		}
		shouldProcessDueFallback := !hasTelegramReviewConfig
		if shouldProcessDueFallback {
			_, _ = h.processDueRealDepositRequests(ctx, 20)
		} else if useTelegramReview {
			if _, err := h.dispatchPendingRealDepositReviewsToTelegram(ctx, chatID, 20); err != nil {
				if isUndefinedTableError(err) || isUndefinedColumnError(err) {
					_, _ = h.processDueRealDepositRequests(ctx, 20)
				} else {
					log.Printf("[deposit-review] failed to dispatch pending requests to telegram: %v", err)
				}
			}
		}
		if telegramRuntimeEnabled && kycChatID != "" {
			if _, err := h.dispatchPendingKYCReviewsToTelegram(ctx, kycChatID, 20); err != nil {
				if !isUndefinedTableError(err) && !isUndefinedColumnError(err) {
					log.Printf("[kyc-review] failed to dispatch pending requests to telegram: %v", err)
				}
			}
		}
	}
	run()

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			run()
		}
	}
}

func (h *Handler) processDueRealDepositRequests(ctx context.Context, limit int) (int, error) {
	if limit <= 0 {
		limit = 1
	}
	processed := 0
	for i := 0; i < limit; i++ {
		ok, err := h.processOneDueRealDepositRequest(ctx)
		if err != nil {
			return processed, err
		}
		if !ok {
			return processed, nil
		}
		processed++
	}
	return processed, nil
}

func (h *Handler) processOneDueRealDepositRequest(ctx context.Context) (bool, error) {
	tx, err := h.svc.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)

	req := dueDepositRequest{}
	err = tx.QueryRow(ctx, `
		SELECT
			ticket_no,
			id::text,
			user_id::text,
			trading_account_id::text,
			amount_usd,
			voucher_kind,
			bonus_amount_usd
		FROM real_deposit_requests
		WHERE status = 'pending'
		  AND review_due_at <= NOW()
		ORDER BY review_due_at ASC, created_at ASC
		FOR UPDATE SKIP LOCKED
		LIMIT 1
	`).Scan(
		&req.TicketNo,
		&req.ID,
		&req.UserID,
		&req.TradingAccountID,
		&req.AmountUSD,
		&req.VoucherKind,
		&req.BonusAmountUSD,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		if isUndefinedTableError(err) {
			return false, nil
		}
		return false, err
	}

	var accountMode string
	if err := tx.QueryRow(ctx, `SELECT mode FROM trading_accounts WHERE id = $1 FOR UPDATE`, req.TradingAccountID).Scan(&accountMode); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			if _, execErr := tx.Exec(ctx, `UPDATE real_deposit_requests SET status = 'rejected', reviewed_at = NOW(), updated_at = NOW() WHERE id = $1`, req.ID); execErr != nil {
				return false, execErr
			}
			if commitErr := tx.Commit(ctx); commitErr != nil {
				return false, commitErr
			}
			ticket := formatRealDepositTicket(req.TicketNo, req.ID)
			h.notifyUserTelegramAsync(
				req.UserID,
				"Deposit request rejected",
				fmt.Sprintf("Request %s was rejected: account was not found.", ticket),
				"#notifications",
			)
			return true, nil
		}
		return false, err
	}
	if strings.TrimSpace(strings.ToLower(accountMode)) != "real" {
		if _, execErr := tx.Exec(ctx, `UPDATE real_deposit_requests SET status = 'rejected', reviewed_at = NOW(), updated_at = NOW() WHERE id = $1`, req.ID); execErr != nil {
			return false, execErr
		}
		if commitErr := tx.Commit(ctx); commitErr != nil {
			return false, commitErr
		}
		ticket := formatRealDepositTicket(req.TicketNo, req.ID)
		h.notifyUserTelegramAsync(
			req.UserID,
			"Deposit request rejected",
			fmt.Sprintf("Request %s was rejected: account type is not real.", ticket),
			"#notifications",
		)
		return true, nil
	}

	var usdAssetID string
	if err := tx.QueryRow(ctx, `SELECT id::text FROM assets WHERE symbol = 'USD'`).Scan(&usdAssetID); err != nil {
		return false, err
	}
	systemAccount, err := h.svc.EnsureSystemAccount(ctx, tx, usdAssetID, types.AccountKindAvailable)
	if err != nil {
		return false, err
	}
	userAccount, err := h.svc.EnsureAccountForTradingAccount(ctx, tx, req.UserID, req.TradingAccountID, usdAssetID, types.AccountKindAvailable)
	if err != nil {
		return false, err
	}

	depositRef := fmt.Sprintf("real_deposit_request:%s", req.ID)
	baseTxID, err := h.svc.Transfer(ctx, tx, systemAccount, userAccount, req.AmountUSD, types.LedgerEntryTypeDeposit, depositRef)
	if err != nil {
		return false, err
	}

	appliedBonusAmount := decimal.Zero
	bonusTxID := ""
	voucherKind := normalizeVoucherKind(req.VoucherKind)
	if voucherKind != "none" && req.BonusAmountUSD.GreaterThan(decimal.Zero) {
		var claimID string
		claimErr := tx.QueryRow(ctx, `
			INSERT INTO deposit_bonus_claims (
				user_id,
				trading_account_id,
				request_id,
				voucher_kind,
				bonus_percent,
				bonus_amount_usd
			) VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (user_id, voucher_kind) DO NOTHING
			RETURNING id::text
		`, req.UserID, req.TradingAccountID, req.ID, voucherKind, voucherPercent(voucherKind), req.BonusAmountUSD).Scan(&claimID)
		if claimErr != nil && !errors.Is(claimErr, pgx.ErrNoRows) {
			return false, claimErr
		}

		if strings.TrimSpace(claimID) != "" {
			bonusRef := fmt.Sprintf("deposit_bonus:%s:%s", voucherKind, req.ID)
			bonusTxID, err = h.svc.Transfer(ctx, tx, systemAccount, userAccount, req.BonusAmountUSD, types.LedgerEntryTypeDeposit, bonusRef)
			if err != nil {
				return false, err
			}
			appliedBonusAmount = req.BonusAmountUSD
		}
	}

	totalCredit := req.AmountUSD.Add(appliedBonusAmount)
	referralCommission, referralInviterID, referralErr := h.applyReferralDepositCommissionTx(
		ctx,
		tx,
		req.UserID,
		req.TradingAccountID,
		req.AmountUSD,
		"real_deposit_request:"+req.ID,
	)
	if referralErr != nil {
		return false, referralErr
	}
	if _, err := tx.Exec(ctx, `
		UPDATE real_deposit_requests
		SET status = 'approved',
			reviewed_at = NOW(),
			updated_at = NOW(),
			approved_tx_id = $2::uuid,
			bonus_tx_id = nullif($3, '')::uuid,
			bonus_amount_usd = $4,
			total_credit_usd = $5
		WHERE id = $1
	`, req.ID, baseTxID, bonusTxID, appliedBonusAmount, totalCredit); err != nil {
		return false, err
	}

	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	if referralCommission.GreaterThan(decimal.Zero) && strings.TrimSpace(referralInviterID) != "" {
		h.notifyUserTelegramAsync(
			referralInviterID,
			"Referral commission credited",
			fmt.Sprintf(
				"You received %s USD (10%%) from referred user's deposit.",
				referralCommission.StringFixed(2),
			),
			"#notifications",
		)
	}
	ticket := formatRealDepositTicket(req.TicketNo, req.ID)
	h.notifyUserTelegramAsync(
		req.UserID,
		"Deposit request approved",
		fmt.Sprintf(
			"Request %s approved: +%s USD (bonus %s, total %s USD).",
			ticket,
			req.AmountUSD.StringFixed(2),
			appliedBonusAmount.StringFixed(2),
			totalCredit.StringFixed(2),
		),
		"#notifications",
	)
	return true, nil
}

func decodeProofBlob(raw string) ([]byte, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return nil, errors.New("proof file is required")
	}
	if idx := strings.Index(value, ","); idx >= 0 && strings.Contains(strings.ToLower(value[:idx]), ";base64") {
		value = value[idx+1:]
	}
	buf, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return nil, errors.New("invalid proof file encoding")
	}
	if len(buf) == 0 {
		return nil, errors.New("proof file is empty")
	}
	return buf, nil
}

func (h *Handler) resolvePreferredRealAccountID(ctx context.Context, userID, preferredID string) (string, error) {
	var id string
	err := h.svc.pool.QueryRow(ctx, `
		SELECT id::text
		FROM trading_accounts
		WHERE user_id = $1
		  AND mode = 'real'
		  AND plan_id = 'standard'
		ORDER BY (id::text = $2) DESC, is_active DESC, created_at ASC
		LIMIT 1
	`, userID, preferredID).Scan(&id)
	if err != nil {
		return "", err
	}
	return id, nil
}

func (h *Handler) loadUsedDepositVoucherMap(ctx context.Context, userID string) (map[string]bool, error) {
	used := map[string]bool{
		"gold":    false,
		"diamond": false,
	}
	rows, err := h.svc.pool.Query(ctx, `
		SELECT voucher_kind
		FROM deposit_bonus_claims
		WHERE user_id = $1
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var kind string
		if err := rows.Scan(&kind); err != nil {
			return nil, err
		}
		k := normalizeVoucherKind(kind)
		if k == "gold" || k == "diamond" {
			used[k] = true
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return used, nil
}

func formatRealDepositTicket(ticketNo int64, seed string) string {
	digits := normalizeLocalTicketNumber(ticketNo, seed)
	letters := localTicketSeedLetters(fmt.Sprintf("real_deposit:%d:%s", ticketNo, seed))
	return "BXdep" + digits + letters
}

func normalizeLocalTicketNumber(value int64, seed string) string {
	v := value
	if v < 0 {
		v = -v
	}
	if v <= 0 {
		v = int64(localTicketSeedNumber(seed))
	}
	v = v % 10000000
	if v <= 0 {
		v = int64(localTicketSeedNumber(seed))
		v = v % 10000000
	}
	if v < 1000000 {
		v += 1000000
	}
	return fmt.Sprintf("%07d", v)
}

func localTicketSeedNumber(seed string) int {
	h := 0
	for _, ch := range seed {
		h = (h*33 + int(ch)) % 9000000
	}
	if h < 1000000 {
		h += 1000000
	}
	return h
}

func localTicketSeedLetters(seed string) string {
	h := 0
	for _, ch := range seed {
		h = (h*131 + int(ch)) % (26 * 26)
	}
	first := byte('a' + ((h / 26) % 26))
	second := byte('a' + (h % 26))
	return string([]byte{first, second})
}
