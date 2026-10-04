package replay

import "sort"

// Called under the service mutex on every persisted change and on startup.
// Completion/download order never determines halftime playback order.
func (a *Service) collectHalfLocked() {
	if a.role != "director" {
		return
	}
	jobs := map[string]Job{}
	events := map[string]Event{}
	for _, j := range a.s.Jobs {
		jobs[j.ID] = j
		for _, e := range j.Events {
			events[e.ID] = e
		}
	}
	for _, e := range a.s.Events {
		events[e.ID] = e
	}
	type clip struct {
		art   Artifact
		event Event
	}
	clips := []clip{}
	for _, v := range a.s.Artifacts {
		j, ok := jobs[v.JobID]
		e, known := events[v.EventID]
		if !ok || !known || j.Status != "READY" || j.Match != a.s.Config.Match || j.Map != a.s.Config.Map || j.Epoch != a.s.Config.Epoch || v.Round < 1 || v.Duration <= 0 || v.Utility != nil || j.Utility != nil || e.Utility != nil || e.Kills <= 0 && e.GroupCount <= 0 {
			continue
		}
		clips = append(clips, clip{v, e})
	}
	sort.Slice(clips, func(i, j int) bool {
		x, y := clips[i], clips[j]
		if x.art.Round != y.art.Round {
			return x.art.Round < y.art.Round
		}
		if x.event.Time != y.event.Time {
			return x.event.Time < y.event.Time
		}
		if x.art.Created != y.art.Created {
			return x.art.Created < y.art.Created
		}
		return x.art.ID < y.art.ID
	})
	ids := []string{}
	halfIDs := []string{}
	seen := map[string]bool{}
	for _, v := range clips {
		if !seen[v.art.ID] && !seen["event:"+v.art.EventID] {
			ids = append(ids, v.art.ID)
			if v.art.Round <= a.s.Output.HalfRound {
				halfIDs = append(halfIDs, v.art.ID)
			}
			seen[v.art.ID] = true
			seen["event:"+v.art.EventID] = true
		}
	}
	if !a.s.Output.FullManual {
		a.s.FullQueue = ids
	}
	if !a.s.Output.HalfManual {
		a.s.HalfQueue = halfIDs
	}
}
