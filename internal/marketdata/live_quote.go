package marketdata

import "sync"

type quoteSnapshot struct {
	Bid float64
	Ask float64
}

var liveQuotes = struct {
	mu   sync.RWMutex
	data map[string]quoteSnapshot
}{
	data: map[string]quoteSnapshot{},
}

func setLiveQuote(pair string, bid, ask float64) {
	if pair == "" || bid <= 0 || ask <= 0 {
		return
	}
	liveQuotes.mu.Lock()
	liveQuotes.data[pair] = quoteSnapshot{Bid: bid, Ask: ask}
	liveQuotes.mu.Unlock()
}

func getLiveQuote(pair string) (bid, ask float64, ok bool) {
	liveQuotes.mu.RLock()
	q, exists := liveQuotes.data[pair]
	liveQuotes.mu.RUnlock()
	if !exists {
		return 0, 0, false
	}
	return q.Bid, q.Ask, true
}
