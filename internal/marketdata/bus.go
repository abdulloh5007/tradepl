package marketdata

import (
	"sync"
)

type Event struct {
	Type string `json:"type"`
	Data any    `json:"data"`
}

type Bus struct {
	mu   sync.RWMutex
	subs map[chan Event]struct{}
}

func NewBus() *Bus {
	return &Bus{subs: make(map[chan Event]struct{})}
}

func (b *Bus) Subscribe() chan Event {
	ch := make(chan Event, 100)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

func (b *Bus) Unsubscribe(ch chan Event) {
	b.mu.Lock()
	if _, ok := b.subs[ch]; ok {
		delete(b.subs, ch)
		close(ch)
	}
	b.mu.Unlock()
}

func (b *Bus) Publish(evt Event) {
	b.mu.RLock()
	for ch := range b.subs {
		select {
		case ch <- evt:
		default:
		}
	}
	b.mu.RUnlock()
}
