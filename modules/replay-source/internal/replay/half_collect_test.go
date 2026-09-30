package replay

import (
	"reflect"
	"testing"
)

func TestAutoHalfCollectionChronologyAndIsolation(t *testing.T) {
	s := testService(t, "director")
	c := s.s.Config
	add := func(id string, round int, at int64, epoch int) {
		e := Event{ID: id, Time: at, Round: round, Kills: 1, GroupCount: 1}
		s.s.Jobs = append(s.s.Jobs, Job{ID: "j" + id, Match: c.Match, Map: c.Map, Epoch: epoch, Events: []Event{e}})
		s.jobUpdate("j"+id, "READY", "", []Artifact{{ID: id, EventID: id, JobID: "j" + id, Round: round, Duration: 1.5, Created: 100 - at}})
	}
	add("r12", 12, 50, c.Epoch)
	add("r2later", 2, 40, c.Epoch)
	add("r1", 1, 90, c.Epoch)
	add("r2early", 2, 20, c.Epoch)
	add("r13", 13, 1, c.Epoch)
	add("overtime", 30, 1, c.Epoch)
	add("old", 1, 1, c.Epoch-1)
	add("warmup", 0, 1, c.Epoch)
	want := []string{"r1", "r2early", "r2later", "r12"}
	fullWant := []string{"r1", "r2early", "r2later", "r12", "r13", "overtime"}
	if !reflect.DeepEqual(s.s.FullQueue, fullWant) {
		t.Fatal("full queue chronology", s.s.FullQueue)
	}
	if !reflect.DeepEqual(s.s.HalfQueue, want) {
		t.Fatal(s.s.HalfQueue)
	}
	// Duplicate download/retry must not duplicate the kill.
	s.s.Artifacts = append(s.s.Artifacts, Artifact{ID: "duplicate", EventID: "r1", JobID: "jr1", Round: 1, Duration: 1.5, Created: 999})
	s.saveLocked()
	if !reflect.DeepEqual(s.s.HalfQueue, want) {
		t.Fatal(s.s.HalfQueue)
	}
	s.s.Jobs[0].Utility = &Utility{}
	s.saveLocked()
	if len(s.s.HalfQueue) != 3 {
		t.Fatal("utility was included")
	}
	s.s.Jobs[0].Utility = nil
	s.saveLocked()
	s.Close()
	restored, err := New(s.dir, "director")
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	if !reflect.DeepEqual(restored.s.HalfQueue, want) {
		t.Fatal("restart lost chronology", restored.s.HalfQueue)
	}
	if w := request(t, restored, "POST", "/api/output/queue", map[string]any{"kind": "half", "ids": []string{"r12"}}, "", ""); w.Code != 400 {
		t.Fatal("manual edit allowed in auto mode")
	}
	cfg := restored.s.Output
	cfg.HalfManual = true
	if w := request(t, restored, "POST", "/api/output/settings", cfg, "", ""); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w := request(t, restored, "POST", "/api/output/queue", map[string]any{"kind": "half", "ids": []string{"r12", "r1"}}, "", ""); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	restored.saveLocked()
	if !reflect.DeepEqual(restored.s.HalfQueue, []string{"r12", "r1"}) {
		t.Fatal("manual order overwritten")
	}
	if !reflect.DeepEqual(restored.s.FullQueue, fullWant) {
		t.Fatal("full queue lost during manual half mode")
	}
	cfg.HalfManual = false
	request(t, restored, "POST", "/api/output/settings", cfg, "", "")
	if !reflect.DeepEqual(restored.s.HalfQueue, want) {
		t.Fatal("did not backfill")
	}
	restored.s.Config.Epoch++
	restored.saveLocked()
	if len(restored.s.HalfQueue) != 0 || len(restored.s.FullQueue) != 0 {
		t.Fatal("old session leaked")
	}
}
