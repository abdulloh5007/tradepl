package volatility

import (
	"encoding/json"
	"net/http"
)

type Handler struct {
	store *Store
}

func NewHandler(store *Store) *Handler {
	return &Handler{store: store}
}

func (h *Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	settings, err := h.store.GetSettings(ctx)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	mode, err := h.store.GetMode(ctx)
	if err != nil {
		mode = "auto"
	}

	response := map[string]interface{}{
		"mode":     mode,
		"settings": settings,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (h *Handler) SetActive(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := h.store.SetActive(r.Context(), req.ID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

func (h *Handler) SetMode(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Mode string `json:"mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := h.store.SetMode(r.Context(), req.Mode); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}
