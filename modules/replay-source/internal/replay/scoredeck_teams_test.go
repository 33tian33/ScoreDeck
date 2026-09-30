package replay

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

func TestScoreDeckRemoteIdentityCompatibility(t *testing.T) {
	s := TeamSettings{ScoreDeckManaged: true, CT: TeamIdentity{Name: "复旦大学", Logo: "data:image/webp;base64,UklGRkIAAABXRUJQVlA4IDYAAADwAgCdASoYABgAPm00lUekIyIhKAgAgA2JZQAARXDkAAD+6ipWv//zBP/f7/v95Y/dgEAAAAA="}, T: TeamIdentity{Name: "上海大学"}, HalfRounds: 10, OvertimeHalfRounds: 2}
	if err := s.validate(); err != nil {
		t.Fatal(err)
	}
	wire, err := s.remoteCompatible()
	if err != nil {
		t.Fatal(err)
	}
	if wire.ScoreDeckManaged || wire.CT.Name != s.CT.Name || wire.HalfRounds != 10 || wire.OvertimeHalfRounds != 2 {
		t.Fatal(wire)
	}
	if !strings.HasPrefix(wire.CT.Logo, "data:image/png;base64,") {
		t.Fatal("legacy agent needs PNG")
	}
	bytes, err := base64.StdEncoding.DecodeString(strings.SplitN(wire.CT.Logo, ",", 2)[1])
	if err != nil || len(bytes) > 256<<10 {
		t.Fatal("bad legacy image")
	}
	if err := wire.validate(); err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(wire)
	if strings.Contains(string(encoded), "scoredeck_managed") {
		t.Fatal("unexpected field on legacy protocol")
	}
	if !strings.HasPrefix(s.CT.Logo, "data:image/webp") {
		t.Fatal("modified original identity")
	}
}
