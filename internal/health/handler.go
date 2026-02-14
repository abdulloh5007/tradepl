package health

import (
	"context"
	"crypto/subtle"
	"fmt"
	"net/http"
	"os"
	"runtime"
	"runtime/debug"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"lv-tradepl/internal/httputil"
)

type Handler struct {
	pool         *pgxpool.Pool
	startedAt    time.Time
	authMode     string
	telegramMode string
	httpAddr     string
	internalTok  string
}

func NewHandler(pool *pgxpool.Pool, startedAt time.Time, authMode, telegramMode, httpAddr, internalToken string) *Handler {
	start := startedAt.UTC()
	if start.IsZero() {
		start = time.Now().UTC()
	}
	return &Handler{
		pool:         pool,
		startedAt:    start,
		authMode:     strings.TrimSpace(authMode),
		telegramMode: strings.TrimSpace(telegramMode),
		httpAddr:     strings.TrimSpace(httpAddr),
		internalTok:  strings.TrimSpace(internalToken),
	}
}

type healthResponse struct {
	Status      string            `json:"status"`
	Timestamp   string            `json:"timestamp"`
	UptimeSec   int64             `json:"uptime_sec"`
	Uptime      string            `json:"uptime"`
	App         appStats          `json:"app"`
	Process     processStats      `json:"process"`
	Runtime     runtimeStats      `json:"runtime"`
	Memory      memoryStats       `json:"memory"`
	Database    databaseStats     `json:"database"`
	Build       buildStats        `json:"build"`
	Diagnostics map[string]string `json:"diagnostics,omitempty"`
}

type appStats struct {
	HTTPAddr     string `json:"http_addr"`
	AuthMode     string `json:"auth_mode"`
	TelegramMode string `json:"telegram_mode"`
}

type processStats struct {
	PID      int    `json:"pid"`
	Hostname string `json:"hostname"`
	GoOS     string `json:"go_os"`
	GoArch   string `json:"go_arch"`
}

type runtimeStats struct {
	GoVersion   string `json:"go_version"`
	Goroutines  int    `json:"goroutines"`
	GoMaxProcs  int    `json:"gomaxprocs"`
	CPUCount    int    `json:"cpu_count"`
	CgoCalls    int64  `json:"cgo_calls"`
	NumGC       uint32 `json:"num_gc"`
	LastGCMsAgo int64  `json:"last_gc_ms_ago"`
}

type memoryStats struct {
	AllocBytes      uint64 `json:"alloc_bytes"`
	HeapAllocBytes  uint64 `json:"heap_alloc_bytes"`
	HeapInuseBytes  uint64 `json:"heap_inuse_bytes"`
	StackInuseBytes uint64 `json:"stack_inuse_bytes"`
	SysBytes        uint64 `json:"sys_bytes"`
	TotalAllocBytes uint64 `json:"total_alloc_bytes"`
	HeapObjects     uint64 `json:"heap_objects"`
}

type databaseStats struct {
	Reachable  bool      `json:"reachable"`
	PingMs     int64     `json:"ping_ms"`
	Error      string    `json:"error,omitempty"`
	CheckedAt  string    `json:"checked_at"`
	Pool       poolStats `json:"pool"`
	HasPool    bool      `json:"has_pool"`
	TimeoutSec int       `json:"timeout_sec"`
}

type poolStats struct {
	TotalConns            int32 `json:"total_conns"`
	IdleConns             int32 `json:"idle_conns"`
	AcquiredConns         int32 `json:"acquired_conns"`
	ConstructingConns     int32 `json:"constructing_conns"`
	MaxConns              int32 `json:"max_conns"`
	NewConnsCount         int64 `json:"new_conns_count"`
	AcquireCount          int64 `json:"acquire_count"`
	CanceledAcquireCount  int64 `json:"canceled_acquire_count"`
	EmptyAcquireCount     int64 `json:"empty_acquire_count"`
	AcquireDurationMs     int64 `json:"acquire_duration_ms"`
	MaxIdleDestroyCount   int64 `json:"max_idle_destroy_count"`
	MaxLifetimeDestroyCnt int64 `json:"max_lifetime_destroy_count"`
}

type buildStats struct {
	MainPath string `json:"main_path"`
	Version  string `json:"version"`
}

type liveResponse struct {
	Status    string `json:"status"`
	Timestamp string `json:"timestamp"`
	UptimeSec int64  `json:"uptime_sec"`
	Uptime    string `json:"uptime"`
}

type readinessResponse struct {
	Status    string          `json:"status"`
	Timestamp string          `json:"timestamp"`
	UptimeSec int64           `json:"uptime_sec"`
	Uptime    string          `json:"uptime"`
	Database  readinessDBStat `json:"database"`
}

type readinessDBStat struct {
	Reachable  bool   `json:"reachable"`
	PingMs     int64  `json:"ping_ms"`
	Error      string `json:"error,omitempty"`
	CheckedAt  string `json:"checked_at"`
	TimeoutSec int    `json:"timeout_sec"`
}

func (h *Handler) uptime(now time.Time) time.Duration {
	uptime := now.Sub(h.startedAt)
	if uptime < 0 {
		return 0
	}
	return uptime
}

func secureTokenEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

func (h *Handler) requireInternalToken(w http.ResponseWriter, r *http.Request) bool {
	if h.internalTok == "" {
		httputil.WriteJSON(w, http.StatusServiceUnavailable, httputil.ErrorResponse{Error: "internal token is not configured"})
		return false
	}
	provided := strings.TrimSpace(r.Header.Get("X-Internal-Token"))
	if !secureTokenEqual(provided, h.internalTok) {
		httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "invalid internal token"})
		return false
	}
	return true
}

func (h *Handler) collectDB(ctx context.Context, includePool bool) databaseStats {
	dbTimeoutSec := 1
	dbCheckedAt := time.Now().UTC()
	dbReachable := false
	dbError := ""
	pingMs := int64(0)
	poolSnapshot := poolStats{}

	if h.pool != nil {
		if includePool {
			stat := h.pool.Stat()
			poolSnapshot = poolStats{
				TotalConns:            stat.TotalConns(),
				IdleConns:             stat.IdleConns(),
				AcquiredConns:         stat.AcquiredConns(),
				ConstructingConns:     stat.ConstructingConns(),
				MaxConns:              stat.MaxConns(),
				NewConnsCount:         stat.NewConnsCount(),
				AcquireCount:          stat.AcquireCount(),
				CanceledAcquireCount:  stat.CanceledAcquireCount(),
				EmptyAcquireCount:     stat.EmptyAcquireCount(),
				AcquireDurationMs:     stat.AcquireDuration().Milliseconds(),
				MaxIdleDestroyCount:   stat.MaxIdleDestroyCount(),
				MaxLifetimeDestroyCnt: stat.MaxLifetimeDestroyCount(),
			}
		}
		pingStart := time.Now()
		pingCtx, cancel := context.WithTimeout(ctx, time.Duration(dbTimeoutSec)*time.Second)
		pingErr := h.pool.Ping(pingCtx)
		cancel()
		pingMs = time.Since(pingStart).Milliseconds()
		dbCheckedAt = time.Now().UTC()
		if pingErr != nil {
			dbError = pingErr.Error()
		} else {
			dbReachable = true
		}
	} else {
		dbError = "pool is not configured"
	}

	return databaseStats{
		Reachable:  dbReachable,
		PingMs:     pingMs,
		Error:      dbError,
		CheckedAt:  dbCheckedAt.Format(time.RFC3339),
		Pool:       poolSnapshot,
		HasPool:    h.pool != nil,
		TimeoutSec: dbTimeoutSec,
	}
}

// Get keeps compatibility: /health is now readiness summary.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	h.Ready(w, r)
}

// Live is a lightweight liveness endpoint and does not check database reachability.
func (h *Handler) Live(w http.ResponseWriter, r *http.Request) {
	now := time.Now().UTC()
	uptime := h.uptime(now)
	httputil.WriteJSON(w, http.StatusOK, liveResponse{
		Status:    "ok",
		Timestamp: now.Format(time.RFC3339),
		UptimeSec: int64(uptime.Seconds()),
		Uptime:    uptime.String(),
	})
}

// Ready checks the primary dependency (database) and returns 503 when it's not reachable.
func (h *Handler) Ready(w http.ResponseWriter, r *http.Request) {
	now := time.Now().UTC()
	uptime := h.uptime(now)
	db := h.collectDB(r.Context(), false)
	status := "ok"
	httpStatus := http.StatusOK
	if !db.Reachable {
		status = "degraded"
		httpStatus = http.StatusServiceUnavailable
	}
	httputil.WriteJSON(w, httpStatus, readinessResponse{
		Status:    status,
		Timestamp: now.Format(time.RFC3339),
		UptimeSec: int64(uptime.Seconds()),
		Uptime:    uptime.String(),
		Database: readinessDBStat{
			Reachable:  db.Reachable,
			PingMs:     db.PingMs,
			Error:      db.Error,
			CheckedAt:  db.CheckedAt,
			TimeoutSec: db.TimeoutSec,
		},
	})
}

// Full returns full diagnostics and is protected by X-Internal-Token.
func (h *Handler) Full(w http.ResponseWriter, r *http.Request) {
	if !h.requireInternalToken(w, r) {
		return
	}

	now := time.Now().UTC()
	uptime := h.uptime(now)

	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	lastGCMsAgo := int64(0)
	if mem.LastGC > 0 {
		lastGCMsAgo = now.Sub(time.Unix(0, int64(mem.LastGC))).Milliseconds()
		if lastGCMsAgo < 0 {
			lastGCMsAgo = 0
		}
	}

	db := h.collectDB(r.Context(), true)

	build := buildStats{}
	if info, ok := debug.ReadBuildInfo(); ok && info != nil {
		build.MainPath = strings.TrimSpace(info.Main.Path)
		build.Version = strings.TrimSpace(info.Main.Version)
	}

	host := ""
	if h, err := os.Hostname(); err == nil {
		host = h
	}

	status := "ok"
	httpStatus := http.StatusOK
	diag := map[string]string{}
	if !db.Reachable {
		status = "degraded"
		httpStatus = http.StatusServiceUnavailable
		if db.Error != "" {
			diag["db_error"] = db.Error
		}
	}

	resp := healthResponse{
		Status:    status,
		Timestamp: now.Format(time.RFC3339),
		UptimeSec: int64(uptime.Seconds()),
		Uptime:    uptime.String(),
		App: appStats{
			HTTPAddr:     h.httpAddr,
			AuthMode:     h.authMode,
			TelegramMode: h.telegramMode,
		},
		Process: processStats{
			PID:      os.Getpid(),
			Hostname: host,
			GoOS:     runtime.GOOS,
			GoArch:   runtime.GOARCH,
		},
		Runtime: runtimeStats{
			GoVersion:   runtime.Version(),
			Goroutines:  runtime.NumGoroutine(),
			GoMaxProcs:  runtime.GOMAXPROCS(0),
			CPUCount:    runtime.NumCPU(),
			CgoCalls:    runtime.NumCgoCall(),
			NumGC:       mem.NumGC,
			LastGCMsAgo: lastGCMsAgo,
		},
		Memory: memoryStats{
			AllocBytes:      mem.Alloc,
			HeapAllocBytes:  mem.HeapAlloc,
			HeapInuseBytes:  mem.HeapInuse,
			StackInuseBytes: mem.StackInuse,
			SysBytes:        mem.Sys,
			TotalAllocBytes: mem.TotalAlloc,
			HeapObjects:     mem.HeapObjects,
		},
		Database: databaseStats{
			Reachable:  db.Reachable,
			PingMs:     db.PingMs,
			Error:      db.Error,
			CheckedAt:  db.CheckedAt,
			Pool:       db.Pool,
			HasPool:    db.HasPool,
			TimeoutSec: db.TimeoutSec,
		},
		Build: build,
	}
	if len(diag) > 0 {
		resp.Diagnostics = diag
	}
	httputil.WriteJSON(w, httpStatus, resp)
}

// Metrics returns basic Prometheus-compatible metrics and is protected by X-Internal-Token.
func (h *Handler) Metrics(w http.ResponseWriter, r *http.Request) {
	if !h.requireInternalToken(w, r) {
		return
	}

	now := time.Now().UTC()
	uptime := h.uptime(now)
	db := h.collectDB(r.Context(), true)
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)

	dbUp := 0
	if db.Reachable {
		dbUp = 1
	}

	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = fmt.Fprintf(w, "# HELP lvtrade_up Service process is running.\n")
	_, _ = fmt.Fprintf(w, "# TYPE lvtrade_up gauge\n")
	_, _ = fmt.Fprintf(w, "lvtrade_up 1\n")

	_, _ = fmt.Fprintf(w, "# HELP lvtrade_uptime_seconds Service uptime in seconds.\n")
	_, _ = fmt.Fprintf(w, "# TYPE lvtrade_uptime_seconds gauge\n")
	_, _ = fmt.Fprintf(w, "lvtrade_uptime_seconds %d\n", int64(uptime.Seconds()))

	_, _ = fmt.Fprintf(w, "# HELP lvtrade_db_up Database ping status (1=ok,0=down).\n")
	_, _ = fmt.Fprintf(w, "# TYPE lvtrade_db_up gauge\n")
	_, _ = fmt.Fprintf(w, "lvtrade_db_up %d\n", dbUp)
	_, _ = fmt.Fprintf(w, "lvtrade_db_ping_milliseconds %d\n", db.PingMs)

	_, _ = fmt.Fprintf(w, "# HELP lvtrade_go_goroutines Number of goroutines.\n")
	_, _ = fmt.Fprintf(w, "# TYPE lvtrade_go_goroutines gauge\n")
	_, _ = fmt.Fprintf(w, "lvtrade_go_goroutines %d\n", runtime.NumGoroutine())
	_, _ = fmt.Fprintf(w, "lvtrade_go_gomaxprocs %d\n", runtime.GOMAXPROCS(0))
	_, _ = fmt.Fprintf(w, "lvtrade_go_mem_alloc_bytes %d\n", mem.Alloc)
	_, _ = fmt.Fprintf(w, "lvtrade_go_mem_heap_alloc_bytes %d\n", mem.HeapAlloc)
	_, _ = fmt.Fprintf(w, "lvtrade_go_mem_heap_inuse_bytes %d\n", mem.HeapInuse)
	_, _ = fmt.Fprintf(w, "lvtrade_go_mem_sys_bytes %d\n", mem.Sys)
	_, _ = fmt.Fprintf(w, "lvtrade_go_gc_count %d\n", mem.NumGC)

	_, _ = fmt.Fprintf(w, "# HELP lvtrade_db_pool_total_conns Current total DB pool connections.\n")
	_, _ = fmt.Fprintf(w, "# TYPE lvtrade_db_pool_total_conns gauge\n")
	_, _ = fmt.Fprintf(w, "lvtrade_db_pool_total_conns %d\n", db.Pool.TotalConns)
	_, _ = fmt.Fprintf(w, "lvtrade_db_pool_idle_conns %d\n", db.Pool.IdleConns)
	_, _ = fmt.Fprintf(w, "lvtrade_db_pool_acquired_conns %d\n", db.Pool.AcquiredConns)
	_, _ = fmt.Fprintf(w, "lvtrade_db_pool_constructing_conns %d\n", db.Pool.ConstructingConns)
	_, _ = fmt.Fprintf(w, "lvtrade_db_pool_max_conns %d\n", db.Pool.MaxConns)
	_, _ = fmt.Fprintf(w, "lvtrade_db_pool_new_conns_count %d\n", db.Pool.NewConnsCount)
	_, _ = fmt.Fprintf(w, "lvtrade_db_pool_acquire_count %d\n", db.Pool.AcquireCount)
	_, _ = fmt.Fprintf(w, "lvtrade_db_pool_canceled_acquire_count %d\n", db.Pool.CanceledAcquireCount)
	_, _ = fmt.Fprintf(w, "lvtrade_db_pool_empty_acquire_count %d\n", db.Pool.EmptyAcquireCount)
	_, _ = fmt.Fprintf(w, "lvtrade_db_pool_acquire_duration_ms %d\n", db.Pool.AcquireDurationMs)
	_, _ = fmt.Fprintf(w, "lvtrade_db_pool_max_idle_destroy_count %d\n", db.Pool.MaxIdleDestroyCount)
	_, _ = fmt.Fprintf(w, "lvtrade_db_pool_max_lifetime_destroy_count %d\n", db.Pool.MaxLifetimeDestroyCnt)
}
