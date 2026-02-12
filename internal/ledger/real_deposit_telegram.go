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
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
	"lv-tradepl/internal/types"
)

const (
	telegramOffsetSettingKey = "telegram_deposit_updates_offset"
	telegramAPIBaseURL       = "https://api.telegram.org"
)

type pendingTelegramDepositReview struct {
	ID               string
	TicketNo         int64
	UserID           string
	UserEmail        string
	TradingAccountID string
	AccountName      string
	AccountMode      string
	PlanID           string
	AmountUSD        decimal.Decimal
	VoucherKind      string
	BonusAmountUSD   decimal.Decimal
	TotalCreditUSD   decimal.Decimal
	ProofFileName    string
	ProofMimeType    string
	ProofBlob        []byte
	ReviewDueAt      time.Time
	CreatedAt        time.Time
}

type telegramAPIBasicResponse struct {
	OK          bool            `json:"ok"`
	Description string          `json:"description"`
	Result      json.RawMessage `json:"result"`
}

type telegramSentMessage struct {
	MessageID int64 `json:"message_id"`
	Chat      struct {
		ID int64 `json:"id"`
	} `json:"chat"`
}

type telegramInlineKeyboardMarkup struct {
	InlineKeyboard [][]telegramInlineKeyboardButton `json:"inline_keyboard"`
}

type telegramInlineKeyboardButton struct {
	Text         string `json:"text"`
	CallbackData string `json:"callback_data,omitempty"`
	Style        string `json:"style,omitempty"`
}

type telegramUser struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
}

type telegramChat struct {
	ID int64 `json:"id"`
}

type telegramMessage struct {
	MessageID int64        `json:"message_id"`
	Chat      telegramChat `json:"chat"`
	From      telegramUser `json:"from"`
	Text      string       `json:"text"`
}

type telegramCallbackQuery struct {
	ID      string           `json:"id"`
	From    telegramUser     `json:"from"`
	Message *telegramMessage `json:"message"`
	Data    string           `json:"data"`
}

type telegramUpdate struct {
	UpdateID      int64                  `json:"update_id"`
	CallbackQuery *telegramCallbackQuery `json:"callback_query"`
	Message       *telegramMessage       `json:"message"`
}

type telegramReviewOutcome struct {
	RequestID string
	Ticket    string
	Status    string
	AmountUSD decimal.Decimal
	BonusUSD  decimal.Decimal
	TotalUSD  decimal.Decimal
}

type manualDecisionRequest struct {
	ID               string
	TicketNo         int64
	Status           string
	UserID           string
	TradingAccountID string
	AmountUSD        decimal.Decimal
	VoucherKind      string
	BonusAmountUSD   decimal.Decimal
	ReviewChatID     int64
	ReviewMessageID  int64
}

func (h *Handler) dispatchPendingRealDepositReviewsToTelegram(ctx context.Context, chatID string, limit int) (int, error) {
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
			r.amount_usd,
			r.voucher_kind,
			r.bonus_amount_usd,
			r.total_credit_usd,
			r.proof_file_name,
			r.proof_mime_type,
			r.proof_blob,
			r.review_due_at,
			r.created_at
		FROM real_deposit_requests r
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
		var req pendingTelegramDepositReview
		if scanErr := rows.Scan(
			&req.ID,
			&req.TicketNo,
			&req.UserID,
			&req.UserEmail,
			&req.TradingAccountID,
			&req.AccountName,
			&req.AccountMode,
			&req.PlanID,
			&req.AmountUSD,
			&req.VoucherKind,
			&req.BonusAmountUSD,
			&req.TotalCreditUSD,
			&req.ProofFileName,
			&req.ProofMimeType,
			&req.ProofBlob,
			&req.ReviewDueAt,
			&req.CreatedAt,
		); scanErr != nil {
			return processed, scanErr
		}

		ticket := formatRealDepositTicket(req.TicketNo, req.ID)
		caption := formatTelegramDepositReviewCaption(req, ticket)
		sent, sendErr := h.telegramSendDepositReviewDocument(ctx, chatID, req, caption, true)
		if sendErr != nil {
			if strings.Contains(strings.ToLower(sendErr.Error()), "style") {
				sent, sendErr = h.telegramSendDepositReviewDocument(ctx, chatID, req, caption, false)
			}
		}
		if sendErr != nil {
			continue
		}

		cmd, updateErr := h.svc.pool.Exec(ctx, `
			UPDATE real_deposit_requests
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

func formatTelegramDepositReviewCaption(req pendingTelegramDepositReview, ticket string) string {
	voucher := normalizeVoucherKind(req.VoucherKind)
	if voucher == "none" {
		voucher = "none"
	}
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
	return fmt.Sprintf(
		"<b>Real Deposit Review</b>\n"+
			"Ticket: <code>%s</code>\n"+
			"User: <code>%s</code>\n"+
			"Email: <code>%s</code>\n"+
			"Account: <code>%s</code> (%s/%s)\n"+
			"Amount: <b>%s USD</b>\n"+
			"Voucher: <b>%s</b>\n"+
			"Bonus: <b>%s USD</b>\n"+
			"Total credit: <b>%s USD</b>\n"+
			"Review by: <code>%s</code>\n"+
			"Request ID: <code>%s</code>",
		ticket,
		req.UserID,
		safeHTML(req.UserEmail),
		safeHTML(account), mode, plan,
		req.AmountUSD.StringFixed(2),
		voucher,
		req.BonusAmountUSD.StringFixed(2),
		req.TotalCreditUSD.StringFixed(2),
		req.ReviewDueAt.UTC().Format("2006-01-02 15:04:05 MST"),
		req.ID,
	)
}

func (h *Handler) telegramSendDepositReviewDocument(ctx context.Context, chatID string, req pendingTelegramDepositReview, caption string, withStyle bool) (telegramSentMessage, error) {
	markup := telegramInlineKeyboardMarkup{InlineKeyboard: [][]telegramInlineKeyboardButton{{
		{Text: "✅ Accept", CallbackData: "dep:approve:" + req.ID, Style: styleIf(withStyle, "success")},
		{Text: "❌ Reject", CallbackData: "dep:reject:" + req.ID, Style: styleIf(withStyle, "danger")},
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
		fileName = "deposit-proof.bin"
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

func styleIf(enabled bool, style string) string {
	if !enabled {
		return ""
	}
	return style
}

func (h *Handler) processTelegramDepositCallbacks(ctx context.Context, configuredChatID string, limit int) (int, error) {
	if limit <= 0 {
		limit = 1
	}
	offset, err := h.getTelegramDepositUpdateOffset(ctx)
	if err != nil {
		return 0, err
	}
	updates := make([]telegramUpdate, 0, limit)
	if err := h.telegramCallJSON(ctx, "getUpdates", map[string]interface{}{
		"offset":          offset,
		"limit":           limit,
		"timeout":         0,
		"allowed_updates": []string{"callback_query", "message"},
	}, &updates); err != nil {
		return 0, err
	}
	if len(updates) == 0 {
		return 0, nil
	}

	targetChatNumeric, hasTargetNumeric := parseTelegramChatID(configuredChatID)
	processed := 0
	nextOffset := offset

	for _, upd := range updates {
		if upd.UpdateID+1 > nextOffset {
			nextOffset = upd.UpdateID + 1
		}
		if msg := upd.Message; msg != nil {
			h.handleTelegramMessageCommand(ctx, *msg)
			continue
		}
		cq := upd.CallbackQuery
		if cq == nil {
			continue
		}
		if cq.Message == nil {
			h.answerTelegramCallbackQuery(ctx, cq.ID, "Unsupported callback", false)
			continue
		}
		if !hasTargetNumeric {
			h.answerTelegramCallbackQuery(ctx, cq.ID, "Review chat is not configured", true)
			continue
		}
		if hasTargetNumeric && cq.Message.Chat.ID != targetChatNumeric {
			h.answerTelegramCallbackQuery(ctx, cq.ID, "Wrong review chat", true)
			continue
		}

		action, requestID, ok := parseDepositReviewCallbackData(cq.Data)
		if !ok {
			h.answerTelegramCallbackQuery(ctx, cq.ID, "Invalid callback data", true)
			continue
		}

		allowed := h.isTelegramReviewerAllowed(ctx, cq.From.ID)
		if !allowed {
			h.answerTelegramCallbackQuery(ctx, cq.ID, "You are not allowed to review deposits", true)
			continue
		}

		outcome, decisionErr := h.applyTelegramDepositReviewDecision(ctx, requestID, action, cq.From.ID)
		if decisionErr != nil {
			h.answerTelegramCallbackQuery(ctx, cq.ID, "Failed to process decision", true)
			continue
		}
		if strings.HasPrefix(outcome.Status, "already_") {
			alreadyStatus := strings.TrimPrefix(outcome.Status, "already_")
			if alreadyStatus == "" {
				alreadyStatus = "processed"
			}
			h.answerTelegramCallbackQuery(ctx, cq.ID, "Already "+alreadyStatus, false)
			h.clearTelegramReviewKeyboard(ctx, cq.Message.Chat.ID, cq.Message.MessageID)
			continue
		}

		reviewerLabel := fmt.Sprintf("tg:%d", cq.From.ID)
		if name := strings.TrimSpace(cq.From.Username); name != "" {
			reviewerLabel = "@" + name
		}

		statusWord := "approved"
		if outcome.Status == "rejected" {
			statusWord = "rejected"
		}
		ack := fmt.Sprintf("%s %s", strings.ToUpper(statusWord[:1])+statusWord[1:], outcome.Ticket)
		h.answerTelegramCallbackQuery(ctx, cq.ID, ack, false)
		h.clearTelegramReviewKeyboard(ctx, cq.Message.Chat.ID, cq.Message.MessageID)
		h.sendTelegramReviewOutcomeMessage(ctx, cq.Message.Chat.ID, outcome, reviewerLabel)
		processed++
	}

	if nextOffset > offset {
		if err := h.saveTelegramDepositUpdateOffset(ctx, nextOffset); err != nil {
			return processed, err
		}
	}

	return processed, nil
}

func (h *Handler) handleTelegramMessageCommand(ctx context.Context, msg telegramMessage) {
	command := parseTelegramCommand(msg.Text)
	switch command {
	case "chid":
		text := fmt.Sprintf("Chat ID: <code>%d</code>", msg.Chat.ID)
		_ = h.telegramCallJSON(ctx, "sendMessage", map[string]interface{}{
			"chat_id":    msg.Chat.ID,
			"text":       text,
			"parse_mode": "HTML",
		}, nil)
	default:
		return
	}
}

func parseTelegramCommand(raw string) string {
	text := strings.TrimSpace(raw)
	if text == "" || !strings.HasPrefix(text, "/") {
		return ""
	}
	parts := strings.Fields(text)
	if len(parts) == 0 {
		return ""
	}
	token := strings.TrimPrefix(parts[0], "/")
	token = strings.ToLower(strings.TrimSpace(token))
	if idx := strings.Index(token, "@"); idx >= 0 {
		token = strings.TrimSpace(token[:idx])
	}
	return token
}

func parseDepositReviewCallbackData(raw string) (action string, requestID string, ok bool) {
	parts := strings.SplitN(strings.TrimSpace(raw), ":", 3)
	if len(parts) != 3 {
		return "", "", false
	}
	if parts[0] != "dep" {
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

func parseTelegramChatID(raw string) (int64, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return 0, false
	}
	v, err := strconv.ParseInt(trimmed, 10, 64)
	if err != nil {
		return 0, false
	}
	return v, true
}

func (h *Handler) isTelegramReviewerAllowed(ctx context.Context, telegramID int64) bool {
	if telegramID == 0 {
		return false
	}
	if h.ownerTgID != 0 && h.ownerTgID == telegramID {
		return true
	}
	var exists bool
	err := h.svc.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM panel_admins WHERE telegram_id = $1)`, telegramID).Scan(&exists)
	if err != nil {
		return false
	}
	return exists
}

func (h *Handler) applyTelegramDepositReviewDecision(ctx context.Context, requestID, action string, reviewerTelegramID int64) (telegramReviewOutcome, error) {
	if action != "approve" && action != "reject" {
		return telegramReviewOutcome{}, errors.New("invalid review action")
	}

	tx, err := h.svc.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return telegramReviewOutcome{}, err
	}
	defer tx.Rollback(ctx)

	req := manualDecisionRequest{}
	err = tx.QueryRow(ctx, `
		SELECT
			id::text,
			ticket_no,
			status,
			user_id::text,
			trading_account_id::text,
			amount_usd,
			voucher_kind,
			bonus_amount_usd,
			COALESCE(review_message_chat_id, 0),
			COALESCE(review_message_id, 0)
		FROM real_deposit_requests
		WHERE id = $1
		FOR UPDATE
	`, requestID).Scan(
		&req.ID,
		&req.TicketNo,
		&req.Status,
		&req.UserID,
		&req.TradingAccountID,
		&req.AmountUSD,
		&req.VoucherKind,
		&req.BonusAmountUSD,
		&req.ReviewChatID,
		&req.ReviewMessageID,
	)
	if err != nil {
		return telegramReviewOutcome{}, err
	}

	ticket := formatRealDepositTicket(req.TicketNo, req.ID)
	if strings.ToLower(strings.TrimSpace(req.Status)) != "pending" {
		alreadyBonus := req.BonusAmountUSD
		if !alreadyBonus.GreaterThan(decimal.Zero) {
			alreadyBonus = decimal.Zero
		}
		normalized := strings.ToLower(strings.TrimSpace(req.Status))
		if normalized == "" {
			normalized = "unknown"
		}
		return telegramReviewOutcome{
			RequestID: req.ID,
			Ticket:    ticket,
			Status:    "already_" + normalized,
			AmountUSD: req.AmountUSD,
			BonusUSD:  alreadyBonus,
			TotalUSD:  req.AmountUSD.Add(alreadyBonus),
		}, nil
	}

	if action == "reject" {
		if _, err := tx.Exec(ctx, `
			UPDATE real_deposit_requests
			SET status = 'rejected',
				reviewed_at = NOW(),
				reviewed_by_telegram_id = $2,
				review_note = 'rejected_via_telegram',
				updated_at = NOW()
			WHERE id = $1
		`, req.ID, reviewerTelegramID); err != nil {
			return telegramReviewOutcome{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return telegramReviewOutcome{}, err
		}
		return telegramReviewOutcome{
			RequestID: req.ID,
			Ticket:    ticket,
			Status:    "rejected",
			AmountUSD: req.AmountUSD,
			BonusUSD:  decimal.Zero,
			TotalUSD:  req.AmountUSD,
		}, nil
	}

	var accountMode string
	var accountPlanID string
	if err := tx.QueryRow(ctx, `
		SELECT mode, plan_id
		FROM trading_accounts
		WHERE id = $1
		FOR UPDATE
	`, req.TradingAccountID).Scan(&accountMode, &accountPlanID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			if _, execErr := tx.Exec(ctx, `
				UPDATE real_deposit_requests
				SET status = 'rejected',
					reviewed_at = NOW(),
					reviewed_by_telegram_id = $2,
					review_note = 'rejected_account_not_found',
					updated_at = NOW()
				WHERE id = $1
			`, req.ID, reviewerTelegramID); execErr != nil {
				return telegramReviewOutcome{}, execErr
			}
			if commitErr := tx.Commit(ctx); commitErr != nil {
				return telegramReviewOutcome{}, commitErr
			}
			return telegramReviewOutcome{RequestID: req.ID, Ticket: ticket, Status: "rejected"}, nil
		}
		return telegramReviewOutcome{}, err
	}
	if strings.TrimSpace(strings.ToLower(accountMode)) != "real" {
		if _, execErr := tx.Exec(ctx, `
			UPDATE real_deposit_requests
			SET status = 'rejected',
				reviewed_at = NOW(),
				reviewed_by_telegram_id = $2,
				review_note = 'rejected_account_not_real',
				updated_at = NOW()
			WHERE id = $1
		`, req.ID, reviewerTelegramID); execErr != nil {
			return telegramReviewOutcome{}, execErr
		}
		if commitErr := tx.Commit(ctx); commitErr != nil {
			return telegramReviewOutcome{}, commitErr
		}
		return telegramReviewOutcome{RequestID: req.ID, Ticket: ticket, Status: "rejected"}, nil
	}

	var usdAssetID string
	if err := tx.QueryRow(ctx, `SELECT id::text FROM assets WHERE symbol = 'USD'`).Scan(&usdAssetID); err != nil {
		return telegramReviewOutcome{}, err
	}
	systemAccount, err := h.svc.EnsureSystemAccount(ctx, tx, usdAssetID, types.AccountKindAvailable)
	if err != nil {
		return telegramReviewOutcome{}, err
	}
	userAccount, err := h.svc.EnsureAccountForTradingAccount(ctx, tx, req.UserID, req.TradingAccountID, usdAssetID, types.AccountKindAvailable)
	if err != nil {
		return telegramReviewOutcome{}, err
	}

	depositRef := fmt.Sprintf("real_deposit_request:%s", req.ID)
	baseTxID, err := h.svc.Transfer(ctx, tx, systemAccount, userAccount, req.AmountUSD, types.LedgerEntryTypeDeposit, depositRef)
	if err != nil {
		return telegramReviewOutcome{}, err
	}

	appliedBonusAmount := decimal.Zero
	bonusTxID := ""
	voucherKind := normalizeVoucherKind(req.VoucherKind)
	isStandardPlan := strings.TrimSpace(strings.ToLower(accountPlanID)) == "standard"
	if !isStandardPlan {
		voucherKind = "none"
	}
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
			ON CONFLICT (user_id) DO NOTHING
			RETURNING id::text
		`, req.UserID, req.TradingAccountID, req.ID, voucherKind, voucherPercent(voucherKind), req.BonusAmountUSD).Scan(&claimID)
		if claimErr != nil && !errors.Is(claimErr, pgx.ErrNoRows) {
			return telegramReviewOutcome{}, claimErr
		}
		if strings.TrimSpace(claimID) != "" {
			bonusRef := fmt.Sprintf("deposit_bonus:%s:%s", voucherKind, req.ID)
			bonusTxID, err = h.svc.Transfer(ctx, tx, systemAccount, userAccount, req.BonusAmountUSD, types.LedgerEntryTypeDeposit, bonusRef)
			if err != nil {
				return telegramReviewOutcome{}, err
			}
			appliedBonusAmount = req.BonusAmountUSD
		}
	}

	totalCredit := req.AmountUSD.Add(appliedBonusAmount)
	if _, err := tx.Exec(ctx, `
		UPDATE real_deposit_requests
		SET status = 'approved',
			reviewed_at = NOW(),
			reviewed_by_telegram_id = $2,
			review_note = 'approved_via_telegram',
			updated_at = NOW(),
			approved_tx_id = $3::uuid,
			bonus_tx_id = NULLIF($4, '')::uuid,
			bonus_amount_usd = $5,
			total_credit_usd = $6
		WHERE id = $1
	`, req.ID, reviewerTelegramID, baseTxID, bonusTxID, appliedBonusAmount, totalCredit); err != nil {
		return telegramReviewOutcome{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return telegramReviewOutcome{}, err
	}

	return telegramReviewOutcome{
		RequestID: req.ID,
		Ticket:    ticket,
		Status:    "approved",
		AmountUSD: req.AmountUSD,
		BonusUSD:  appliedBonusAmount,
		TotalUSD:  totalCredit,
	}, nil
}

func (h *Handler) clearTelegramReviewKeyboard(ctx context.Context, chatID int64, messageID int64) {
	if chatID == 0 || messageID == 0 {
		return
	}
	_ = h.telegramCallJSON(ctx, "editMessageReplyMarkup", map[string]interface{}{
		"chat_id":    chatID,
		"message_id": messageID,
		"reply_markup": map[string]interface{}{
			"inline_keyboard": [][]interface{}{},
		},
	}, nil)
}

func (h *Handler) sendTelegramReviewOutcomeMessage(ctx context.Context, chatID int64, outcome telegramReviewOutcome, reviewerLabel string) {
	if chatID == 0 {
		return
	}
	icon := "✅"
	if strings.EqualFold(outcome.Status, "rejected") {
		icon = "❌"
	}
	text := fmt.Sprintf(
		"%s Deposit %s\nTicket: <code>%s</code>\nAmount: <b>%s USD</b>\nBonus: <b>%s USD</b>\nTotal: <b>%s USD</b>\nReviewer: <b>%s</b>",
		icon,
		strings.ToUpper(strings.TrimSpace(outcome.Status)),
		outcome.Ticket,
		outcome.AmountUSD.StringFixed(2),
		outcome.BonusUSD.StringFixed(2),
		outcome.TotalUSD.StringFixed(2),
		safeHTML(reviewerLabel),
	)
	_ = h.telegramCallJSON(ctx, "sendMessage", map[string]interface{}{
		"chat_id":    chatID,
		"text":       text,
		"parse_mode": "HTML",
	}, nil)
}

func (h *Handler) answerTelegramCallbackQuery(ctx context.Context, callbackID, text string, showAlert bool) {
	if strings.TrimSpace(callbackID) == "" {
		return
	}
	_ = h.telegramCallJSON(ctx, "answerCallbackQuery", map[string]interface{}{
		"callback_query_id": callbackID,
		"text":              text,
		"show_alert":        showAlert,
	}, nil)
}

func (h *Handler) getTelegramDepositUpdateOffset(ctx context.Context) (int64, error) {
	var raw string
	err := h.svc.pool.QueryRow(ctx, `SELECT value FROM system_settings WHERE key = $1`, telegramOffsetSettingKey).Scan(&raw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || isUndefinedTableError(err) {
			return 0, nil
		}
		return 0, err
	}
	v, parseErr := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if parseErr != nil || v < 0 {
		return 0, nil
	}
	return v, nil
}

func (h *Handler) saveTelegramDepositUpdateOffset(ctx context.Context, offset int64) error {
	if offset < 0 {
		offset = 0
	}
	_, err := h.svc.pool.Exec(ctx, `
		INSERT INTO system_settings(key, value, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (key)
		DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
	`, telegramOffsetSettingKey, strconv.FormatInt(offset, 10))
	if err != nil && isUndefinedTableError(err) {
		return nil
	}
	return err
}

func (h *Handler) telegramCallJSON(ctx context.Context, method string, payload interface{}, out interface{}) error {
	if strings.TrimSpace(h.tgBotToken) == "" {
		return errors.New("telegram bot token is not configured")
	}
	if payload == nil {
		payload = map[string]interface{}{}
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.telegramMethodURL(method), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := h.telegramHTTPClient().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	var parsed telegramAPIBasicResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return err
	}
	if !parsed.OK {
		desc := strings.TrimSpace(parsed.Description)
		if desc == "" {
			desc = "telegram request failed"
		}
		return errors.New(desc)
	}
	if out != nil && len(parsed.Result) > 0 {
		if err := json.Unmarshal(parsed.Result, out); err != nil {
			return err
		}
	}
	return nil
}

func (h *Handler) telegramMethodURL(method string) string {
	return fmt.Sprintf("%s/bot%s/%s", telegramAPIBaseURL, strings.TrimSpace(h.tgBotToken), strings.TrimSpace(method))
}

func (h *Handler) telegramHTTPClient() *http.Client {
	return &http.Client{Timeout: 20 * time.Second}
}

func safeHTML(raw string) string {
	repl := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		"\"", "&quot;",
	)
	return repl.Replace(raw)
}
