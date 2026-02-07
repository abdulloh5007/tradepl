package volatility

type Setting struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Value         float64 `json:"value"`
	Spread        float64 `json:"spread"`
	ScheduleStart string  `json:"schedule_start"`
	ScheduleEnd   string  `json:"schedule_end"`
	IsActive      bool    `json:"is_active"`
}

type Config struct {
	ID         string
	Volatility float64
	Spread     float64
}
