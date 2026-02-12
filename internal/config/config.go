package config

import (
	"errors"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	HTTPAddr         string
	DBDSN            string
	JWTIssuer        string
	JWTSecret        string
	JWTTTL           time.Duration
	InternalToken    string
	WebSocketOrigin  string
	ProfectMode      string
	TelegramBotToken string
	OwnerTelegramID  int64
	UIDist           string
	FaucetEnabled    bool
	FaucetMax        string
	MarketDataDir    string
}

func Load() (Config, error) {
	var c Config
	var missing []string
	c.HTTPAddr = os.Getenv("HTTP_ADDR")
	if c.HTTPAddr == "" {
		missing = append(missing, "HTTP_ADDR")
	}
	c.DBDSN = os.Getenv("DB_DSN")
	if c.DBDSN == "" {
		missing = append(missing, "DB_DSN")
	}
	c.JWTIssuer = os.Getenv("JWT_ISSUER")
	if c.JWTIssuer == "" {
		missing = append(missing, "JWT_ISSUER")
	}
	c.JWTSecret = os.Getenv("JWT_SECRET")
	if c.JWTSecret == "" {
		missing = append(missing, "JWT_SECRET")
	}
	jwtTTL := os.Getenv("JWT_TTL")
	if jwtTTL == "" {
		missing = append(missing, "JWT_TTL")
	} else {
		d, err := time.ParseDuration(jwtTTL)
		if err != nil {
			return c, err
		}
		c.JWTTTL = d
	}
	c.InternalToken = os.Getenv("INTERNAL_API_TOKEN")
	if c.InternalToken == "" {
		missing = append(missing, "INTERNAL_API_TOKEN")
	}
	c.WebSocketOrigin = os.Getenv("WS_ORIGIN")
	if c.WebSocketOrigin == "" {
		missing = append(missing, "WS_ORIGIN")
	}
	c.ProfectMode = strings.ToLower(strings.TrimSpace(os.Getenv("PROFECT_MODE")))
	if c.ProfectMode == "" {
		c.ProfectMode = "development"
	}
	if c.ProfectMode != "development" && c.ProfectMode != "production" {
		return c, errors.New("invalid PROFECT_MODE: use development or production")
	}
	c.TelegramBotToken = os.Getenv("TELEGRAM_BOT_TOKEN")
	if c.ProfectMode == "production" && c.TelegramBotToken == "" {
		missing = append(missing, "TELEGRAM_BOT_TOKEN")
	}
	ownerTelegramRaw := strings.TrimSpace(os.Getenv("OWNER_TELEGRAM_ID"))
	if ownerTelegramRaw != "" {
		ownerTelegramID, err := strconv.ParseInt(ownerTelegramRaw, 10, 64)
		if err != nil {
			return c, errors.New("invalid OWNER_TELEGRAM_ID")
		}
		c.OwnerTelegramID = ownerTelegramID
	}
	c.UIDist = os.Getenv("UI_DIST")
	c.MarketDataDir = os.Getenv("MARKETDATA_DIR")
	faucetEnabled := os.Getenv("FAUCET_ENABLED")
	if faucetEnabled == "" {
		c.FaucetEnabled = true
	} else {
		b, err := strconv.ParseBool(faucetEnabled)
		if err != nil {
			return c, err
		}
		c.FaucetEnabled = b
	}
	max := os.Getenv("FAUCET_MAX")
	if max == "" {
		max = "100000"
	}
	c.FaucetMax = max
	if len(missing) > 0 {
		return c, errors.New("missing required env: " + join(missing))
	}
	return c, nil
}

func join(items []string) string {
	if len(items) == 0 {
		return ""
	}
	out := items[0]
	for i := 1; i < len(items); i++ {
		out += "," + items[i]
	}
	return out
}
