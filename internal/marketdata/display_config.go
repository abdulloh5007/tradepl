package marketdata

// IsDisplayInverted reports whether UI renders the pair inverted
// (e.g. UZS-USD shown as 1/raw to display ~12k prices).
func IsDisplayInverted(pair string) bool {
	return pair == "UZS-USD"
}
