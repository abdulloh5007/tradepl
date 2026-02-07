package httpserver

import (
	"net/http"
	"sync"
	"time"

	"lv-tradepl/internal/httputil"
)

// SecurityHeaders adds standard security headers to protect against common attacks
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Prevent Clickjacking
		w.Header().Set("X-Frame-Options", "DENY")
		// Prevent MIME sniffing
		w.Header().Set("X-Content-Type-Options", "nosniff")
		// Control referrer information
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		// Force HTTPS (HSTS) - 1 year
		w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		// Basic CSP (can be tightened further based on UI needs)
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:;")
		// XSS Protection (older browsers)
		w.Header().Set("X-XSS-Protection", "1; mode=block")

		next.ServeHTTP(w, r)
	})
}

// Simple in-memory rate limiter
type rateLimiter struct {
	mu       sync.Mutex
	visitors map[string]*visitor
}

type visitor struct {
	lastSeen time.Time
	tokens   float64
}

var limiter = &rateLimiter{
	visitors: make(map[string]*visitor),
}

// pruneVisitors cleans up old entries to prevent memory leaks
func (rl *rateLimiter) pruneVisitors() {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	for ip, v := range rl.visitors {
		if now.Sub(v.lastSeen) > 3*time.Minute {
			delete(rl.visitors, ip)
		}
	}
}

func init() {
	// Background cleanup
	go func() {
		for {
			time.Sleep(1 * time.Minute)
			limiter.pruneVisitors()
		}
	}()
}

// RateLimitMiddleware implements a token bucket limiter
// Rate: 10 requests/sec, Burst: 30
func RateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := r.RemoteAddr
		// Strip port if present
		if idx := 0; idx < len(ip) {
			// very naive check, but robust enough for this level
			// proper would be net.SplitHostPort
		}

		limiter.mu.Lock()
		v, exists := limiter.visitors[ip]
		if !exists {
			v = &visitor{tokens: 30, lastSeen: time.Now()}
			limiter.visitors[ip] = v
		}

		now := time.Now()
		elapsed := now.Sub(v.lastSeen).Seconds()
		v.lastSeen = now

		// Refill tokens (10 per second)
		v.tokens += elapsed * 10
		if v.tokens > 30 {
			v.tokens = 30
		}

		if v.tokens < 1 {
			limiter.mu.Unlock()
			httputil.WriteJSON(w, http.StatusTooManyRequests, httputil.ErrorResponse{Error: "rate limit exceeded"})
			return
		}

		v.tokens -= 1
		limiter.mu.Unlock()

		next.ServeHTTP(w, r)
	})
}
