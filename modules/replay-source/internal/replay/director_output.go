package replay

import (
	"errors"
	"net/http"
	"os"
)

// The director bar displays one ready clip from the current capture session.
func (a *Service) latestDirectorClipLocked() *Artifact {
	var latest *Artifact
	for _, v := range a.s.Artifacts {
		if !a.currentArtifactLocked(v) || (latest != nil && v.Created < latest.Created) {
			continue
		}
		info, err := os.Stat(v.Path)
		if err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
			continue
		}
		copy := v
		latest = &copy
	}
	return latest
}

func (a *Service) directorOutputRoutes(api *http.ServeMux) {
	api.HandleFunc("GET /api/output/director", func(w http.ResponseWriter, r *http.Request) {
		a.mu.Lock()
		defer a.mu.Unlock()
		respond(w, 200, map[string]any{"clip": a.latestDirectorClipLocked(), "connected": nowMS()-a.outputSeen <= 3000, "busy": a.output.ID != "" && a.output.Due == 0})
	})
	api.HandleFunc("POST /api/output/clip", func(w http.ResponseWriter, r *http.Request) {
		var p struct {
			ID   string  `json:"id"`
			Rate float64 `json:"rate"`
		}
		if err := decode(w, r, &p); err != nil {
			fail(w, err)
			return
		}
		a.mu.Lock()
		defer a.mu.Unlock()
		if a.role != "director" {
			fail(w, errors.New("仅导播端可播出"))
			return
		}
		if p.Rate != .25 && p.Rate != .5 && p.Rate != 1 {
			fail(w, errors.New("播放倍率须为 0.25、0.5 或 1"))
			return
		}
		clip := a.latestDirectorClipLocked()
		if clip == nil || clip.ID != p.ID {
			fail(w, errors.New("最新 Replay 已更新，请重新点击预览"))
			return
		}
		if a.output.ID != "" && a.output.Due == 0 {
			fail(w, errors.New("已有回放正在播出，请先返回直播"))
			return
		}
		if nowMS()-a.outputSeen > 3000 {
			fail(w, errors.New("Replay 浏览器输出未连接，请先在 OBS 中打开输出"))
			return
		}
		items := []OutputItem{}
		if a.s.Output.Transition1 != "" {
			items = append(items, OutputItem{a.s.Output.Transition1, "transition"})
		}
		items = append(items, OutputItem{clip.ID, "replay"})
		if a.s.Output.Transition2 != "" {
			items = append(items, OutputItem{a.s.Output.Transition2, "transition"})
		}
		a.output = OutputSession{ID: id(), Kind: "clip", Round: clip.Round, Items: items, Rate: p.Rate, Deadline: nowMS() + int64(120000/p.Rate)}
		a.outputError = ""
		respond(w, 200, map[string]bool{"ok": true})
	})
}
