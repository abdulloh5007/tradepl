package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	systemUpdaterSettingKey       = "system_updater_config"
	defaultUpdaterIntervalMinutes = 10
	minUpdaterIntervalMinutes     = 1
	maxUpdaterIntervalMinutes     = 1440
	maxUpdaterOutputLen           = 4000
)

var ErrUpdaterBusy = errors.New("updater is busy")

type UpdaterOptions struct {
	Enabled       bool
	RepoDir       string
	DeployCommand string
	DefaultBranch string
}

type UpdaterConfig struct {
	AutoEnabled     bool `json:"auto_enabled"`
	IntervalMinutes int  `json:"interval_minutes"`
}

type UpdaterStatus struct {
	Enabled          bool   `json:"enabled"`
	RepoDir          string `json:"repo_dir,omitempty"`
	DeployCommand    string `json:"deploy_command,omitempty"`
	AutoEnabled      bool   `json:"auto_enabled"`
	IntervalMinutes  int    `json:"interval_minutes"`
	Busy             bool   `json:"busy"`
	BusyKind         string `json:"busy_kind,omitempty"`
	CurrentBranch    string `json:"current_branch,omitempty"`
	CurrentRevision  string `json:"current_revision,omitempty"`
	RemoteRevision   string `json:"remote_revision,omitempty"`
	UpdateAvailable  bool   `json:"update_available"`
	LastCheckedAt    string `json:"last_checked_at,omitempty"`
	LastCheckOK      bool   `json:"last_check_ok"`
	LastCheckError   string `json:"last_check_error,omitempty"`
	LastUpdatedAt    string `json:"last_updated_at,omitempty"`
	LastUpdateOK     bool   `json:"last_update_ok"`
	LastUpdateError  string `json:"last_update_error,omitempty"`
	LastUpdateOutput string `json:"last_update_output,omitempty"`
	NextAutoCheckAt  string `json:"next_auto_check_at,omitempty"`
}

type updaterState struct {
	busy             bool
	busyKind         string
	currentBranch    string
	currentRevision  string
	remoteRevision   string
	updateAvailable  bool
	lastCheckedAt    time.Time
	lastCheckOK      bool
	lastCheckError   string
	lastUpdatedAt    time.Time
	lastUpdateOK     bool
	lastUpdateError  string
	lastUpdateOutput string
	lastAutoCheckAt  time.Time
}

type checkResult struct {
	Branch    string
	Head      string
	Remote    string
	Available bool
}

type UpdaterManager struct {
	pool          *pgxpool.Pool
	enabled       bool
	repoDir       string
	deployCommand string
	defaultBranch string

	mu        sync.RWMutex
	cfg       UpdaterConfig
	cfgLoaded bool
	state     updaterState
}

func NewUpdaterManager(pool *pgxpool.Pool, opts UpdaterOptions) *UpdaterManager {
	repoDir := strings.TrimSpace(opts.RepoDir)
	if repoDir == "" {
		if wd, err := os.Getwd(); err == nil {
			repoDir = wd
		}
	}
	if repoDir != "" {
		repoDir = filepath.Clean(repoDir)
	}
	mgr := &UpdaterManager{
		pool:          pool,
		enabled:       opts.Enabled,
		repoDir:       repoDir,
		deployCommand: strings.TrimSpace(opts.DeployCommand),
		defaultBranch: strings.TrimSpace(opts.DefaultBranch),
		cfg: UpdaterConfig{
			AutoEnabled:     false,
			IntervalMinutes: defaultUpdaterIntervalMinutes,
		},
	}
	if mgr.defaultBranch == "" {
		mgr.defaultBranch = "main"
	}
	return mgr
}

func (u *UpdaterManager) Start(ctx context.Context) {
	if !u.enabled {
		return
	}
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			u.runAutoCycle(ctx)
		}
	}
}

func (u *UpdaterManager) runAutoCycle(ctx context.Context) {
	cfg, err := u.getConfig(ctx)
	if err != nil || !cfg.AutoEnabled {
		return
	}
	now := time.Now().UTC()
	u.mu.RLock()
	lastAuto := u.state.lastAutoCheckAt
	busy := u.state.busy
	u.mu.RUnlock()
	if busy {
		return
	}
	if !lastAuto.IsZero() && now.Sub(lastAuto) < time.Duration(cfg.IntervalMinutes)*time.Minute {
		return
	}

	u.mu.Lock()
	u.state.lastAutoCheckAt = now
	u.mu.Unlock()

	status, err := u.CheckNow(ctx)
	if err != nil || !status.UpdateAvailable {
		return
	}
	_, _ = u.UpdateNow(ctx)
}

func (u *UpdaterManager) Status(ctx context.Context) (UpdaterStatus, error) {
	if _, err := u.getConfig(ctx); err != nil {
		return UpdaterStatus{}, err
	}
	return u.snapshotLocked(time.Now().UTC()), nil
}

func (u *UpdaterManager) UpdateConfig(ctx context.Context, cfg UpdaterConfig) (UpdaterStatus, error) {
	if !u.enabled {
		return UpdaterStatus{}, errors.New("updater is disabled")
	}
	cfg = normalizeUpdaterConfig(cfg)
	if err := u.saveConfig(ctx, cfg); err != nil {
		return UpdaterStatus{}, err
	}
	u.mu.Lock()
	u.cfg = cfg
	u.cfgLoaded = true
	u.mu.Unlock()
	return u.snapshotLocked(time.Now().UTC()), nil
}

func (u *UpdaterManager) CheckNow(ctx context.Context) (UpdaterStatus, error) {
	if !u.enabled {
		return UpdaterStatus{}, errors.New("updater is disabled")
	}
	if !u.beginBusy("check") {
		return u.snapshotLocked(time.Now().UTC()), ErrUpdaterBusy
	}
	defer u.endBusy()

	checkCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	result, err := u.performCheck(checkCtx)

	now := time.Now().UTC()
	u.mu.Lock()
	u.state.lastCheckedAt = now
	u.state.lastCheckOK = err == nil
	if err != nil {
		u.state.lastCheckError = err.Error()
	} else {
		u.state.lastCheckError = ""
		u.state.currentBranch = result.Branch
		u.state.currentRevision = result.Head
		u.state.remoteRevision = result.Remote
		u.state.updateAvailable = result.Available
	}
	status := u.snapshotNoLock(now)
	u.mu.Unlock()

	if err != nil {
		return status, err
	}
	return status, nil
}

func (u *UpdaterManager) UpdateNow(ctx context.Context) (UpdaterStatus, error) {
	if !u.enabled {
		return UpdaterStatus{}, errors.New("updater is disabled")
	}
	if strings.TrimSpace(u.deployCommand) == "" {
		return UpdaterStatus{}, errors.New("updater deploy command is not configured")
	}
	if !u.beginBusy("update") {
		return u.snapshotLocked(time.Now().UTC()), ErrUpdaterBusy
	}
	defer u.endBusy()

	updateCtx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	output, err := u.runDeploy(updateCtx)
	trimmedOutput := trimOutput(output)

	now := time.Now().UTC()
	u.mu.Lock()
	u.state.lastUpdatedAt = now
	u.state.lastUpdateOK = err == nil
	u.state.lastUpdateOutput = trimmedOutput
	if err != nil {
		u.state.lastUpdateError = err.Error()
	} else {
		u.state.lastUpdateError = ""
	}
	u.mu.Unlock()

	checkCtx, checkCancel := context.WithTimeout(ctx, 30*time.Second)
	_, checkErr := u.performAndStoreCheck(checkCtx)
	checkCancel()
	if err == nil && checkErr != nil {
		err = checkErr
	}

	status := u.snapshotLocked(time.Now().UTC())
	if err != nil {
		return status, err
	}
	return status, nil
}

func (u *UpdaterManager) performAndStoreCheck(ctx context.Context) (checkResult, error) {
	result, err := u.performCheck(ctx)
	now := time.Now().UTC()
	u.mu.Lock()
	u.state.lastCheckedAt = now
	u.state.lastCheckOK = err == nil
	if err != nil {
		u.state.lastCheckError = err.Error()
	} else {
		u.state.lastCheckError = ""
		u.state.currentBranch = result.Branch
		u.state.currentRevision = result.Head
		u.state.remoteRevision = result.Remote
		u.state.updateAvailable = result.Available
	}
	u.mu.Unlock()
	return result, err
}

func (u *UpdaterManager) performCheck(ctx context.Context) (checkResult, error) {
	if strings.TrimSpace(u.repoDir) == "" {
		return checkResult{}, errors.New("updater repo directory is not configured")
	}
	branchRaw, branchErr := u.runGit(ctx, "rev-parse", "--abbrev-ref", "HEAD")
	branch := strings.TrimSpace(branchRaw)
	if branch == "" || strings.EqualFold(branch, "HEAD") {
		branch = u.defaultBranch
	}
	if branchErr != nil {
		branch = u.defaultBranch
	}

	if _, err := u.runGit(ctx, "fetch", "origin", branch, "--quiet"); err != nil {
		if _, fallbackErr := u.runGit(ctx, "fetch", "origin", "--quiet"); fallbackErr != nil {
			return checkResult{}, fmt.Errorf("git fetch failed: %w", fallbackErr)
		}
	}

	headRaw, err := u.runGit(ctx, "rev-parse", "HEAD")
	if err != nil {
		return checkResult{}, fmt.Errorf("git rev-parse HEAD failed: %w", err)
	}
	head := shortRevision(headRaw)
	remoteRef := "origin/" + branch
	remoteRaw, err := u.runGit(ctx, "rev-parse", remoteRef)
	if err != nil {
		if branch != u.defaultBranch {
			remoteRef = "origin/" + u.defaultBranch
			remoteRaw, err = u.runGit(ctx, "rev-parse", remoteRef)
			if err == nil {
				branch = u.defaultBranch
			}
		}
		if err != nil {
			return checkResult{}, fmt.Errorf("git rev-parse %s failed: %w", remoteRef, err)
		}
	}
	remote := shortRevision(remoteRaw)

	return checkResult{
		Branch:    branch,
		Head:      head,
		Remote:    remote,
		Available: head != "" && remote != "" && head != remote,
	}, nil
}

func (u *UpdaterManager) runDeploy(ctx context.Context) (string, error) {
	cmd := exec.CommandContext(ctx, "sh", "-lc", u.deployCommand)
	cmd.Dir = u.repoDir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("deploy command failed: %w", err)
	}
	return string(out), nil
}

func (u *UpdaterManager) runGit(ctx context.Context, args ...string) (string, error) {
	gitArgs := append([]string{"-C", u.repoDir}, args...)
	cmd := exec.CommandContext(ctx, "git", gitArgs...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		trimmed := strings.TrimSpace(string(out))
		if trimmed == "" {
			return "", err
		}
		return "", fmt.Errorf("%w: %s", err, trimmed)
	}
	return strings.TrimSpace(string(out)), nil
}

func (u *UpdaterManager) beginBusy(kind string) bool {
	u.mu.Lock()
	defer u.mu.Unlock()
	if u.state.busy {
		return false
	}
	u.state.busy = true
	u.state.busyKind = strings.TrimSpace(kind)
	return true
}

func (u *UpdaterManager) endBusy() {
	u.mu.Lock()
	u.state.busy = false
	u.state.busyKind = ""
	u.mu.Unlock()
}

func (u *UpdaterManager) snapshotLocked(now time.Time) UpdaterStatus {
	u.mu.RLock()
	defer u.mu.RUnlock()
	return u.snapshotNoLock(now)
}

func (u *UpdaterManager) snapshotNoLock(now time.Time) UpdaterStatus {
	cfg := normalizeUpdaterConfig(u.cfg)
	status := UpdaterStatus{
		Enabled:          u.enabled,
		RepoDir:          u.repoDir,
		DeployCommand:    u.deployCommand,
		AutoEnabled:      cfg.AutoEnabled,
		IntervalMinutes:  cfg.IntervalMinutes,
		Busy:             u.state.busy,
		BusyKind:         u.state.busyKind,
		CurrentBranch:    u.state.currentBranch,
		CurrentRevision:  u.state.currentRevision,
		RemoteRevision:   u.state.remoteRevision,
		UpdateAvailable:  u.state.updateAvailable,
		LastCheckOK:      u.state.lastCheckOK,
		LastCheckError:   u.state.lastCheckError,
		LastUpdateOK:     u.state.lastUpdateOK,
		LastUpdateError:  u.state.lastUpdateError,
		LastUpdateOutput: u.state.lastUpdateOutput,
	}
	if !u.state.lastCheckedAt.IsZero() {
		status.LastCheckedAt = u.state.lastCheckedAt.UTC().Format(time.RFC3339)
	}
	if !u.state.lastUpdatedAt.IsZero() {
		status.LastUpdatedAt = u.state.lastUpdatedAt.UTC().Format(time.RFC3339)
	}
	if u.enabled && cfg.AutoEnabled {
		next := now
		if !u.state.lastAutoCheckAt.IsZero() {
			next = u.state.lastAutoCheckAt.Add(time.Duration(cfg.IntervalMinutes) * time.Minute)
		}
		status.NextAutoCheckAt = next.UTC().Format(time.RFC3339)
	}
	return status
}

func (u *UpdaterManager) getConfig(ctx context.Context) (UpdaterConfig, error) {
	u.mu.RLock()
	if u.cfgLoaded {
		cfg := normalizeUpdaterConfig(u.cfg)
		u.mu.RUnlock()
		return cfg, nil
	}
	u.mu.RUnlock()

	cfg, err := u.loadConfig(ctx)
	if err != nil {
		return UpdaterConfig{}, err
	}
	cfg = normalizeUpdaterConfig(cfg)

	u.mu.Lock()
	u.cfg = cfg
	u.cfgLoaded = true
	u.mu.Unlock()
	return cfg, nil
}

func (u *UpdaterManager) loadConfig(ctx context.Context) (UpdaterConfig, error) {
	if u.pool == nil {
		return UpdaterConfig{}, errors.New("database is unavailable")
	}
	var raw string
	err := u.pool.QueryRow(ctx, `
		SELECT value
		FROM system_settings
		WHERE key = $1
	`, systemUpdaterSettingKey).Scan(&raw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || isUndefinedTableError(err) {
			return UpdaterConfig{AutoEnabled: false, IntervalMinutes: defaultUpdaterIntervalMinutes}, nil
		}
		return UpdaterConfig{}, err
	}
	var cfg UpdaterConfig
	if unmarshalErr := json.Unmarshal([]byte(raw), &cfg); unmarshalErr != nil {
		return UpdaterConfig{}, unmarshalErr
	}
	return cfg, nil
}

func (u *UpdaterManager) saveConfig(ctx context.Context, cfg UpdaterConfig) error {
	if u.pool == nil {
		return errors.New("database is unavailable")
	}
	encoded, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	_, err = u.pool.Exec(ctx, `
		INSERT INTO system_settings(key, value, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (key)
		DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
	`, systemUpdaterSettingKey, string(encoded))
	return err
}

func normalizeUpdaterConfig(cfg UpdaterConfig) UpdaterConfig {
	if cfg.IntervalMinutes < minUpdaterIntervalMinutes || cfg.IntervalMinutes > maxUpdaterIntervalMinutes {
		cfg.IntervalMinutes = defaultUpdaterIntervalMinutes
	}
	return cfg
}

func shortRevision(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if len(trimmed) > 12 {
		return trimmed[:12]
	}
	return trimmed
}

func trimOutput(raw string) string {
	text := strings.TrimSpace(raw)
	if len(text) <= maxUpdaterOutputLen {
		return text
	}
	return text[len(text)-maxUpdaterOutputLen:]
}

func isUndefinedTableError(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "42P01"
}
