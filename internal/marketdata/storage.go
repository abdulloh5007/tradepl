package marketdata

import (
	"bufio"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type CandleStore struct {
	dir       string
	mu        sync.Mutex
	lastClose map[string]float64
	lastTime  map[string]int64
}

func NewCandleStore(dir string) *CandleStore {
	return &CandleStore{dir: dir, lastClose: map[string]float64{}, lastTime: map[string]int64{}}
}

func (s *CandleStore) path() string {
	return filepath.Join(s.dir, "1m.ndjson")
}

type candleLine struct {
	T int64   `json:"t"`
	O float64 `json:"o"`
	H float64 `json:"h"`
	L float64 `json:"l"`
	C float64 `json:"c"`
	V float64 `json:"v"`
}

func (s *CandleStore) ensureBaseKey(key string) (string, error) {
	parts := strings.Split(key, "|")
	if len(parts) != 2 {
		return "", errors.New("invalid key")
	}
	if parts[1] != "1m" {
		return "", errors.New("non-1m storage forbidden")
	}
	return parts[0], nil
}

func (s *CandleStore) Append(key string, candle Candle) error {
	if s.dir == "" {
		return nil
	}
	pair, err := s.ensureBaseKey(key)
	if err != nil {
		return err
	}
	open := priceToFloat(candle.Open)
	high := priceToFloat(candle.High)
	low := priceToFloat(candle.Low)
	close := priceToFloat(candle.Close)
	if candle.Time%60 != 0 || high < low || open < low || open > high || close < low || close > high {
		panic("candle validation failed")
	}
	path := s.path()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.lastClose[pair]; !ok {
		_ = s.loadLastFromFileLocked(pair)
	}
	if last, ok := s.lastClose[pair]; ok {
		if !floatEqual(last, open) {
			panic("open price must equal previous close")
		}
	}
	if lastTime, ok := s.lastTime[pair]; ok {
		if candle.Time <= lastTime {
			panic("non-append candle")
		}
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer file.Close()
	line := candleLine{
		T: candle.Time,
		O: open,
		H: high,
		L: low,
		C: close,
		V: 0,
	}
	data, err := json.Marshal(line)
	if err != nil {
		return err
	}
	if _, err := file.Write(append(data, '\n')); err != nil {
		return err
	}
	s.lastClose[pair] = close
	s.lastTime[pair] = candle.Time
	return nil
}

func (s *CandleStore) LoadRecent(key string, limit int, prec int) ([]Candle, error) {
	if s.dir == "" {
		return nil, os.ErrNotExist
	}
	pair, err := s.ensureBaseKey(key)
	if err != nil {
		return nil, err
	}
	path := s.path()
	out := make([]Candle, 0, limit)
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		var line candleLine
		if err := json.Unmarshal(scanner.Bytes(), &line); err != nil {
			continue
		}
		out = append(out, Candle{
			Time:  line.T,
			Open:  formatPrice(line.O, prec),
			High:  formatPrice(line.H, prec),
			Low:   formatPrice(line.L, prec),
			Close: formatPrice(line.C, prec),
		})
	}
	if limit > 0 && len(out) > limit {
		out = out[len(out)-limit:]
	}
	if len(out) > 0 {
		last := out[len(out)-1]
		s.mu.Lock()
		s.lastClose[pair] = priceToFloat(last.Close)
		s.lastTime[pair] = last.Time
		s.mu.Unlock()
	}
	return out, nil
}

func (s *CandleStore) loadLastFromFileLocked(pair string) error {
	path := s.path()
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	var last candleLine
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		var line candleLine
		if err := json.Unmarshal(scanner.Bytes(), &line); err != nil {
			continue
		}
		last = line
	}
	if last.T > 0 {
		s.lastClose[pair] = last.C
		s.lastTime[pair] = last.T
	}
	return nil
}

func floatEqual(a, b float64) bool {
	diff := a - b
	if diff < 0 {
		diff = -diff
	}
	return diff <= 0.00000001
}
