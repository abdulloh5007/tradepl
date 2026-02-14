package ledger

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
	"lv-tradepl/internal/types"
)

type pendingTelegramKYCReview struct {
	ID               string
	TicketNo         int64
	UserID           string
	UserEmail        string
	TradingAccountID string
	AccountName      string
	AccountMode      string
	PlanID           string
	DocumentType     string
	FullName         string
	DocumentNumber   string
	ResidenceAddress string
	Notes            string
	ProofFileName    string
	ProofMimeType    string
	ProofBlob        []byte
	ReviewDueAt      time.Time
	CreatedAt        time.Time
}

type telegramKYCReviewOutcome struct {
	RequestID        string
	Ticket           string
	Status           string
	BonusAmountUSD   decimal.Decimal
	FailedAttempts   int
	BlockedUntil     *time.Time
	PermanentBlocked bool
}

type kycDecisionRequest struct {
	ID               string
	TicketNo         int64
	Status           string
	UserID           string
	TradingAccountID string
	ReviewChatID     int64
	ReviewMessageID  int64
}

func (h *Handler) dispatchPendingKYCReviewsToTelegram(ctx context.Context, chatID string, limit int) (int, error) {
	if limit <= 0 {
		limit = 1
	}
	rows, err := h.svc.pool.Query(ctx, `
		SELECT
			r.id::text,
			r.ticket_no,
			r.user_id::text,
			COALESCE(u.email, ''),
			r.trading_account_id::text,
			COALESCE(ta.name, ''),
			COALESCE(ta.mode, ''),
			COALESCE(ta.plan_id, ''),
			r.document_type,
			r.full_name,
			r.document_number,
			r.residence_address,
			r.notes,
			r.proof_file_name,
			r.proof_mime_type,
			r.proof_blob,
			r.review_due_at,
			r.created_at
		FROM kyc_verification_requests r
		LEFT JOIN users u ON u.id = r.user_id
		LEFT JOIN trading_accounts ta ON ta.id = r.trading_account_id
		WHERE r.status = 'pending'
		  AND r.review_message_id IS NULL
		ORDER BY r.created_at ASC
		LIMIT $1
	`, limit)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	processed := 0
	for rows.Next() {
		var req pendingTelegramKYCReview
		if scanErr := rows.Scan(
			&req.ID,
			&req.TicketNo,
			&req.UserID,
			&req.UserEmail,
			&req.TradingAccountID,
			&req.AccountName,
			&req.AccountMode,
			&req.PlanID,
			&req.DocumentType,
			&req.FullName,
			&req.DocumentNumber,
			&req.ResidenceAddress,
			&req.Notes,
			&req.ProofFileName,
			&req.ProofMimeType,
			&req.ProofBlob,
			&req.ReviewDueAt,
			&req.CreatedAt,
		); scanErr != nil {
			return processed, scanErr
		}

		ticket := formatKYCRequestTicket(req.TicketNo, req.ID)
		caption := formatTelegramKYCReviewCaption(req, ticket)
		sent, sendErr := h.telegramSendKYCReviewDocument(ctx, chatID, req, caption, true)
		if sendErr != nil {
			if strings.Contains(strings.ToLower(sendErr.Error()), "style") {
				sent, sendErr = h.telegramSendKYCReviewDocument(ctx, chatID, req, caption, false)
			}
		}
		if sendErr != nil {
			continue
		}

		cmd, updateErr := h.svc.pool.Exec(ctx, `
			UPDATE kyc_verification_requests
			SET review_message_chat_id = $2,
				review_message_id = $3,
				updated_at = NOW()
			WHERE id = $1
			  AND status = 'pending'
			  AND review_message_id IS NULL
		`, req.ID, sent.Chat.ID, sent.MessageID)
		if updateErr != nil {
			continue
		}
		if cmd.RowsAffected() > 0 {
			processed++
		}
	}
	if err := rows.Err(); err != nil {
		return processed, err
	}
	return processed, nil
}

func formatTelegramKYCReviewCaption(req pendingTelegramKYCReview, ticket string) string {
	account := strings.TrimSpace(req.AccountName)
	if account == "" {
		account = req.TradingAccountID
	}
	mode := strings.TrimSpace(req.AccountMode)
	if mode == "" {
		mode = "real"
	}
	plan := strings.TrimSpace(req.PlanID)
	if plan == "" {
		plan = "standard"
	}
	notes := strings.TrimSpace(req.Notes)
	if notes == "" {
		notes = "-"
	}
	return fmt.Sprintf(
		"<b>KYC Review</b>\n"+
			"Ticket: <code>%s</code>\n"+
			"User: <code>%s</code>\n"+
			"Email: <code>%s</code>\n"+
			"Account: <code>%s</code> (%s/%s)\n"+
			"Document type: <b>%s</b>\n"+
			"Full name: <b>%s</b>\n"+
			"Document no: <code>%s</code>\n"+
			"Residence: <b>%s</b>\n"+
			"Notes: <b>%s</b>\n"+
			"Review by: <code>%s</code>\n"+
			"Request ID: <code>%s</code>",
		ticket,
		req.UserID,
		safeHTML(req.UserEmail),
		safeHTML(account), mode, plan,
		safeHTML(req.DocumentType),
		safeHTML(req.FullName),
		safeHTML(req.DocumentNumber),
		safeHTML(req.ResidenceAddress),
		safeHTML(notes),
		req.ReviewDueAt.UTC().Format("2006-01-02 15:04:05 MST"),
		req.ID,
	)
}

func (h *Handler) telegramSendKYCReviewDocument(ctx context.Context, chatID string, req pendingTelegramKYCReview, caption string, withStyle bool) (telegramSentMessage, error) {
	markup := telegramInlineKeyboardMarkup{InlineKeyboard: [][]telegramInlineKeyboardButton{{
		{Text: "✅ Approve KYC", CallbackData: "kyc:approve:" + req.ID, Style: styleIf(withStyle, "success")},
		{Text: "❌ Reject KYC", CallbackData: "kyc:reject:" + req.ID, Style: styleIf(withStyle, "danger")},
	}}}
	if !withStyle {
		for i := range markup.InlineKeyboard {
			for j := range markup.InlineKeyboard[i] {
				markup.InlineKeyboard[i][j].Style = ""
			}
		}
	}

	markupJSON, err := json.Marshal(markup)
	if err != nil {
		return telegramSentMessage{}, err
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("chat_id", chatID); err != nil {
		return telegramSentMessage{}, err
	}
	if err := writer.WriteField("caption", caption); err != nil {
		return telegramSentMessage{}, err
	}
	if err := writer.WriteField("parse_mode", "HTML"); err != nil {
		return telegramSentMessage{}, err
	}
	if err := writer.WriteField("reply_markup", string(markupJSON)); err != nil {
		return telegramSentMessage{}, err
	}

	fileName := strings.TrimSpace(req.ProofFileName)
	if fileName == "" {
		fileName = "kyc-proof.bin"
	}
	part, err := writer.CreateFormFile("document", fileName)
	if err != nil {
		return telegramSentMessage{}, err
	}
	if _, err := part.Write(req.ProofBlob); err != nil {
		return telegramSentMessage{}, err
	}
	if err := writer.Close(); err != nil {
		return telegramSentMessage{}, err
	}

	url := h.telegramMethodURL("sendDocument")
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, &body)
	if err != nil {
		return telegramSentMessage{}, err
	}
	httpReq.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := h.telegramHTTPClient().Do(httpReq)
	if err != nil {
		return telegramSentMessage{}, err
	}
	defer resp.Body.Close()

	payload, err := io.ReadAll(resp.Body)
	if err != nil {
		return telegramSentMessage{}, err
	}

	var parsed telegramAPIBasicResponse
	if err := json.Unmarshal(payload, &parsed); err != nil {
		return telegramSentMessage{}, err
	}
	if !parsed.OK {
		desc := strings.TrimSpace(parsed.Description)
		if desc == "" {
			desc = "telegram sendDocument failed"
		}
		return telegramSentMessage{}, errors.New(desc)
	}

	var msg telegramSentMessage
	if err := json.Unmarshal(parsed.Result, &msg); err != nil {
		return telegramSentMessage{}, err
	}
	return msg, nil
}

func parseKYCReviewCallbackData(raw string) (action string, requestID string, ok bool) {
	parts := strings.SplitN(strings.TrimSpace(raw), ":", 3)
	if len(parts) != 3 {
		return "", "", false
	}
	if parts[0] != "kyc" {
		return "", "", false
	}
	action = strings.ToLower(strings.TrimSpace(parts[1]))
	if action != "approve" && action != "reject" {
		return "", "", false
	}
	requestID = strings.TrimSpace(parts[2])
	if requestID == "" {
		return "", "", false
	}
	return action, requestID, true
}

func (h *Handler) isTelegramKYCReviewerAllowed(ctx context.Context, telegramID int64) bool {
	if telegramID == 0 {
		return false
	}
	if h.ownerTgID != 0 && h.ownerTgID == telegramID {
		return true
	}

	var allowed bool
	err := h.svc.pool.QueryRow(ctx, `
		SELECT COALESCE((rights->>'kyc_review')::boolean, FALSE)
		FROM panel_admins
		WHERE telegram_id = $1
	`, telegramID).Scan(&allowed)
	if err != nil {
		return false
	}
	return allowed
}

func (h *Handler) applyTelegramKYCReviewDecision(ctx context.Context, requestID, action string, reviewerTelegramID int64) (telegramKYCReviewOutcome, error) {
	if action != "approve" && action != "reject" {
		return telegramKYCReviewOutcome{}, errors.New("invalid review action")
	}

	tx, err := h.svc.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return telegramKYCReviewOutcome{}, err
	}
	defer tx.Rollback(ctx)

	req := kycDecisionRequest{}
	err = tx.QueryRow(ctx, `
		SELECT
			id::text,
			ticket_no,
			status,
			user_id::text,
			trading_account_id::text,
			COALESCE(review_message_chat_id, 0),
			COALESCE(review_message_id, 0)
		FROM kyc_verification_requests
		WHERE id = $1
		FOR UPDATE
	`, requestID).Scan(
		&req.ID,
		&req.TicketNo,
		&req.Status,
		&req.UserID,
		&req.TradingAccountID,
		&req.ReviewChatID,
		&req.ReviewMessageID,
	)
	if err != nil {
		return telegramKYCReviewOutcome{}, err
	}

	ticket := formatKYCRequestTicket(req.TicketNo, req.ID)
	if strings.ToLower(strings.TrimSpace(req.Status)) != "pending" {
		normalized := strings.ToLower(strings.TrimSpace(req.Status))
		if normalized == "" {
			normalized = "unknown"
		}
		return telegramKYCReviewOutcome{
			RequestID: req.ID,
			Ticket:    ticket,
			Status:    "already_" + normalized,
		}, nil
	}

	if action == "reject" {
		failedAttempts, blockedUntil, permanentBlocked, penaltyErr := h.applyKYCRejectionPenaltyTx(ctx, tx, req.UserID)
		if penaltyErr != nil {
			return telegramKYCReviewOutcome{}, penaltyErr
		}
		if _, err := tx.Exec(ctx, `
			UPDATE kyc_verification_requests
			SET status = 'rejected',
				reviewed_at = NOW(),
				reviewed_by_telegram_id = $2,
				review_note = $3,
				updated_at = NOW()
			WHERE id = $1
		`, req.ID, reviewerTelegramID, fmt.Sprintf("rejected_via_telegram_attempt_%d", failedAttempts)); err != nil {
			return telegramKYCReviewOutcome{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return telegramKYCReviewOutcome{}, err
		}

		h.notifyUserTelegramAsync(
			req.UserID,
			"KYC request rejected",
			fmt.Sprintf("%s Ticket: %s.", formatKYCBlockMessage(blockedUntil, permanentBlocked), ticket),
			"#notifications",
		)
		return telegramKYCReviewOutcome{
			RequestID:        req.ID,
			Ticket:           ticket,
			Status:           "rejected",
			FailedAttempts:   failedAttempts,
			BlockedUntil:     blockedUntil,
			PermanentBlocked: permanentBlocked,
		}, nil
	}

	var alreadyClaimed bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM kyc_bonus_claims WHERE user_id = $1)
	`, req.UserID).Scan(&alreadyClaimed); err != nil {
		return telegramKYCReviewOutcome{}, err
	}
	if alreadyClaimed {
		if _, err := tx.Exec(ctx, `
			UPDATE kyc_verification_requests
			SET status = 'rejected',
				reviewed_at = NOW(),
				reviewed_by_telegram_id = $2,
				review_note = 'rejected_bonus_already_claimed',
				updated_at = NOW()
			WHERE id = $1
		`, req.ID, reviewerTelegramID); err != nil {
			return telegramKYCReviewOutcome{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return telegramKYCReviewOutcome{}, err
		}
		return telegramKYCReviewOutcome{
			RequestID: req.ID,
			Ticket:    ticket,
			Status:    "rejected",
		}, nil
	}

	cfg, cfgErr := h.loadBonusProgramConfigTx(ctx, tx)
	if cfgErr != nil {
		return telegramKYCReviewOutcome{}, cfgErr
	}

	target, targetErr := h.resolveKYCBonusTargetAccountTx(ctx, tx, req.UserID, req.TradingAccountID)
	if targetErr != nil {
		if errors.Is(targetErr, pgx.ErrNoRows) {
			if _, err := tx.Exec(ctx, `
				UPDATE kyc_verification_requests
				SET status = 'rejected',
					reviewed_at = NOW(),
					reviewed_by_telegram_id = $2,
					review_note = 'rejected_no_real_standard_account',
					updated_at = NOW()
				WHERE id = $1
			`, req.ID, reviewerTelegramID); err != nil {
				return telegramKYCReviewOutcome{}, err
			}
			if err := tx.Commit(ctx); err != nil {
				return telegramKYCReviewOutcome{}, err
			}
			return telegramKYCReviewOutcome{
				RequestID: req.ID,
				Ticket:    ticket,
				Status:    "rejected",
			}, nil
		}
		return telegramKYCReviewOutcome{}, targetErr
	}

	var usdAssetID string
	if err := tx.QueryRow(ctx, `SELECT id::text FROM assets WHERE symbol = 'USD'`).Scan(&usdAssetID); err != nil {
		return telegramKYCReviewOutcome{}, err
	}
	systemAccount, err := h.svc.EnsureSystemAccount(ctx, tx, usdAssetID, types.AccountKindAvailable)
	if err != nil {
		return telegramKYCReviewOutcome{}, err
	}
	userAccount, err := h.svc.EnsureAccountForTradingAccount(ctx, tx, req.UserID, target.ID, usdAssetID, types.AccountKindAvailable)
	if err != nil {
		return telegramKYCReviewOutcome{}, err
	}

	ledgerTxID, err := h.svc.Transfer(
		ctx,
		tx,
		systemAccount,
		userAccount,
		cfg.KYCBonusAmount,
		types.LedgerEntryTypeDeposit,
		kycRewardRef(req.ID),
	)
	if err != nil {
		return telegramKYCReviewOutcome{}, err
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO kyc_bonus_claims (
			user_id,
			trading_account_id,
			request_id,
			amount_usd,
			ledger_tx_id
		) VALUES ($1, $2, $3, $4, $5)
	`, req.UserID, target.ID, req.ID, cfg.KYCBonusAmount, ledgerTxID); err != nil {
		return telegramKYCReviewOutcome{}, err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE kyc_verification_requests
		SET status = 'approved',
			reviewed_at = NOW(),
			reviewed_by_telegram_id = $2,
			review_note = 'approved_via_telegram',
			bonus_tx_id = $3::uuid,
			updated_at = NOW()
		WHERE id = $1
	`, req.ID, reviewerTelegramID, ledgerTxID); err != nil {
		return telegramKYCReviewOutcome{}, err
	}

	if err := h.clearKYCStateTx(ctx, tx, req.UserID); err != nil {
		return telegramKYCReviewOutcome{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return telegramKYCReviewOutcome{}, err
	}

	h.notifyUserTelegramAsync(
		req.UserID,
		"KYC approved",
		fmt.Sprintf(
			"KYC approved. %s USD bonus credited to account %s.",
			cfg.KYCBonusAmount.StringFixed(2),
			target.Name,
		),
		"#notifications",
	)
	return telegramKYCReviewOutcome{
		RequestID:      req.ID,
		Ticket:         ticket,
		Status:         "approved",
		BonusAmountUSD: cfg.KYCBonusAmount,
	}, nil
}

func (h *Handler) sendTelegramKYCReviewOutcomeMessage(ctx context.Context, chatID int64, outcome telegramKYCReviewOutcome, reviewerLabel string) {
	if chatID == 0 {
		return
	}
	icon := "✅"
	status := strings.ToUpper(strings.TrimSpace(outcome.Status))
	lines := []string{
		fmt.Sprintf("%s KYC %s", icon, status),
		fmt.Sprintf("Ticket: <code>%s</code>", outcome.Ticket),
		fmt.Sprintf("Reviewer: <b>%s</b>", safeHTML(reviewerLabel)),
	}
	if strings.EqualFold(outcome.Status, "rejected") {
		icon = "❌"
		lines[0] = fmt.Sprintf("%s KYC %s", icon, status)
		if outcome.PermanentBlocked {
			lines = append(lines, "User KYC state: <b>PERMANENT BLOCK</b>")
		} else if outcome.BlockedUntil != nil {
			lines = append(lines, fmt.Sprintf("Blocked until: <code>%s</code>", outcome.BlockedUntil.UTC().Format("2006-01-02 15:04:05 MST")))
		}
		if outcome.FailedAttempts > 0 {
			lines = append(lines, fmt.Sprintf("Failed attempts: <b>%d</b>", outcome.FailedAttempts))
		}
	}
	if strings.EqualFold(outcome.Status, "approved") {
		lines = append(lines, fmt.Sprintf("Bonus: <b>%s USD</b>", outcome.BonusAmountUSD.StringFixed(2)))
	}
	text := strings.Join(lines, "\n")
	_ = h.telegramCallJSON(ctx, "sendMessage", map[string]interface{}{
		"chat_id":    chatID,
		"text":       text,
		"parse_mode": "HTML",
	}, nil)
}
