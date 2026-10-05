package replay

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestDirectorSingleClipOutputIsIsolated(t *testing.T) {
	a := outputFixture(t)
	a.s.Artifacts[1].Created = 100
	a.s.Artifacts[3].Created = 200 // Old capture session must not win.
	queue := append([]string(nil), a.s.Queue...)
	settings := a.s.Output
	w := request(t, a, "GET", "/api/output/director", nil, "", "")
	var status struct {
		Clip      Artifact `json:"clip"`
		Connected bool     `json:"connected"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &status); err != nil {
		t.Fatal(err)
	}
	if status.Clip.ID != "b" || !status.Connected {
		t.Fatal(status)
	}
	for _, p := range []map[string]any{{"id": "old", "rate": .5}, {"id": "a", "rate": 1}, {"id": "b", "rate": 2}} {
		if w := request(t, a, "POST", "/api/output/clip", p, "", ""); w.Code == 200 {
			t.Fatal("invalid click accepted", p)
		}
	}
	if a.output.ID != "" {
		t.Fatal("invalid click started output")
	}
	if w := request(t, a, "POST", "/api/output/clip", map[string]any{"id": "b", "rate": .25}, "", ""); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	want := []OutputItem{{"intro.webm", "transition"}, {"b", "replay"}, {"outro.mp4", "transition"}}
	if a.output.Kind != "clip" || a.output.Rate != .25 || !reflect.DeepEqual(a.output.Items, want) {
		t.Fatal(a.output)
	}
	if a.output.Deadline < nowMS()+470000 {
		t.Fatal("slow clip deadline too short")
	}
	a.appendOutputLocked()
	if !reflect.DeepEqual(a.output.Items, want) {
		t.Fatal("single clip acquired queue entries")
	}
	if w := request(t, a, "POST", "/api/output/clip", map[string]any{"id": "b", "rate": .5}, "", ""); w.Code == 200 {
		t.Fatal("interrupted active output")
	}
	session := a.output.ID
	for i := 0; i < 3; i++ {
		if w := request(t, a, "POST", "/output-api/ack", map[string]any{"id": session, "index": i, "client": "obs"}, "", ""); w.Code != 200 {
			t.Fatal(w.Body.String())
		}
	}
	if a.output.ID != "" {
		t.Fatal("clip output did not finish")
	}
	if !reflect.DeepEqual(a.s.Queue, queue) || a.s.Output != settings {
		t.Fatal("single clip changed global configuration")
	}
	if err := a.startOutputLocked("round", 1); err != nil {
		t.Fatal(err)
	}
	if a.output.Rate != 0 || len(a.output.Items) != 4 {
		t.Fatal("rate leaked into normal replay", a.output)
	}
}

func TestDirectorClipRequiresConnectedOutput(t *testing.T) {
	a := outputFixture(t)
	a.outputSeen = 0
	if w := request(t, a, "POST", "/api/output/clip", map[string]any{"id": "c", "rate": 1}, "", ""); w.Code == 200 {
		t.Fatal("disconnected output accepted")
	}
	if a.output.ID != "" {
		t.Fatal("disconnected output started")
	}
}
