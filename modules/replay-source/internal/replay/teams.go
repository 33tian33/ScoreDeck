package replay

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
	"image"
	_ "image/jpeg"
	"image/png"
	"net/http"
	"os"
	"strings"
)

type TeamIdentity struct {
	Name string `json:"name"`
	Logo string `json:"logo"`
}
type TeamSettings struct {
	ScoreDeckManaged   bool         `json:"scoredeck_managed,omitempty"`
	CT                 TeamIdentity `json:"ct"`
	T                  TeamIdentity `json:"t"`
	HalfRounds         int          `json:"half_rounds"`
	OvertimeHalfRounds int          `json:"overtime_half_rounds"`
}

func (s TeamSettings) validate() error {
	if s.HalfRounds < 0 || s.HalfRounds > 100 || s.OvertimeHalfRounds < 0 || s.OvertimeHalfRounds > 100 {
		return errors.New("换边回合数必须为 1–100（0 使用默认 12 / 3）")
	}
	for _, t := range []TeamIdentity{s.CT, s.T} {
		if len(t.Name) > 200 {
			return errors.New("战队名称过长")
		}
		if t.Logo == "" {
			continue
		}
		parts := strings.SplitN(t.Logo, ",", 2)
		if len(parts) != 2 || (parts[0] != "data:image/png;base64" && parts[0] != "data:image/jpeg;base64" && parts[0] != "data:image/webp;base64") {
			return errors.New("图标须为 PNG、JPEG 或 WebP")
		}
		b, err := base64.StdEncoding.DecodeString(parts[1])
		if err != nil || len(b) > 1024<<10 {
			return errors.New("图标格式错误或超过 1 MB")
		}
		c, format, err := image.DecodeConfig(bytes.NewReader(b))
		if err != nil || c.Width > 2048 || c.Height > 2048 || c.Width < 1 || c.Height < 1 || parts[0] != "data:image/"+format+";base64" {
			return errors.New("图标须为有效的 PNG / JPEG / WebP，尺寸不超过 2048×2048")
		}
	}
	return nil
}
func (s TeamSettings) swapped(round int) bool {
	half, ot := s.HalfRounds, s.OvertimeHalfRounds
	if half == 0 {
		half = 12
	}
	if ot == 0 {
		ot = 3
	}
	played := max(0, round-1)
	if played < half*2 {
		return played >= half
	}
	// First overtime continues the second-half sides; switch every OT half.
	return ((played-half*2)/ot)%2 == 0
}
func (a *Service) teamRoutes(mux, api *http.ServeMux) {
	api.HandleFunc("POST /api/teams", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("agent") == "1" && a.role != "agent" {
			fail(w, errors.New("同步目标必须是 Linux Agent"))
			return
		}
		var s TeamSettings
		if err := decode(w, r, &s); err != nil {
			fail(w, err)
			return
		}
		if err := s.validate(); err != nil {
			fail(w, err)
			return
		}
		a.mu.Lock()
		trusted := os.Getenv("SD_INSTANCE") != "" && r.Header.Get("X-ScoreDeck-Instance") == os.Getenv("SD_INSTANCE")
		if !trusted {
			if a.s.Config.Teams.ScoreDeckManaged {
				s.CT = a.s.Config.Teams.CT
				s.T = a.s.Config.Teams.T
			}
			s.ScoreDeckManaged = a.s.Config.Teams.ScoreDeckManaged
		}
		a.s.Config.Teams = s
		a.saveLocked()
		storageErr := a.storageErr
		c := a.s.Config
		a.mu.Unlock()
		if storageErr != "" {
			fail(w, errors.New(storageErr))
			return
		}
		if a.role == "director" && remoteConfigured(c) {
			var err error
			s, err = s.remoteCompatible()
			if err != nil {
				fail(w, err)
				return
			}
			if err := remoteCall(r.Context(), c, "POST", "/api/teams?agent=1", s, nil); err != nil {
				fail(w, fmt.Errorf("本机战队设置已保存，Linux 同步失败，请重试：%w", err))
				return
			}
		}
		respond(w, 200, map[string]bool{"ok": true, "synced": a.role == "director" && remoteConfigured(c)})
	})
	mux.HandleFunc("GET /hud-api/state", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		a.mu.Lock()
		defer a.mu.Unlock()
		side := "b"
		if a.role == "director" {
			side = "a"
		}
		p := a.previous[side]
		m := obj(p, "map")
		s := a.s.Config.Teams
		round := a.gsiRound[side] + 1
		ct, tt := s.CT, s.T
		if s.swapped(round) {
			ct, tt = tt, ct
		}
		if ct.Name == "" {
			ct.Name = stringField(obj(m, "team_ct"), "name")
			if ct.Name == "" {
				ct.Name = "CT"
			}
		}
		if tt.Name == "" {
			tt.Name = stringField(obj(m, "team_t"), "name")
			if tt.Name == "" {
				tt.Name = "T"
			}
		}
		w.Header().Set("Cache-Control", "no-store")
		respond(w, 200, map[string]any{"ct": ct, "t": tt, "ct_score": number(obj(m, "team_ct"), "score"), "t_score": number(obj(m, "team_t"), "score"), "round": round, "clock": a.roundClocks[side].Clock, "fresh": nowMS()-a.gsiSeen[side] < 2000, "visible": !a.hudHidden})
	})
}

// Older Linux agents accept PNG/JPEG up to 256 KB. Keep their wire format intact.
func (s TeamSettings) remoteCompatible() (TeamSettings, error) {
	s.ScoreDeckManaged = false
	for _, team := range []*TeamIdentity{&s.CT, &s.T} {
		if team.Logo == "" {
			continue
		}
		parts := strings.SplitN(team.Logo, ",", 2)
		if len(parts) != 2 {
			return s, errors.New("无效队标")
		}
		raw, err := base64.StdEncoding.DecodeString(parts[1])
		if err != nil {
			return s, err
		}
		if parts[0] != "data:image/webp;base64" && len(raw) <= 256<<10 {
			continue
		}
		img, _, err := image.Decode(bytes.NewReader(raw))
		if err != nil {
			return s, err
		}
		bounds := img.Bounds()
		width, height := bounds.Dx(), bounds.Dy()
		for limit := 512; limit >= 32; limit /= 2 {
			w, h := width, height
			if max(w, h) > limit {
				if w >= h {
					h = max(1, h*limit/w)
					w = limit
				} else {
					w = max(1, w*limit/h)
					h = limit
				}
			}
			target := image.NewNRGBA(image.Rect(0, 0, w, h))
			draw.CatmullRom.Scale(target, target.Bounds(), img, bounds, draw.Over, nil)
			var output bytes.Buffer
			if err := png.Encode(&output, target); err != nil {
				return s, err
			}
			if output.Len() <= 256<<10 {
				team.Logo = "data:image/png;base64," + base64.StdEncoding.EncodeToString(output.Bytes())
				break
			}
			if limit == 32 {
				return s, errors.New("无法压缩远端队标")
			}
		}
	}
	return s, nil
}
