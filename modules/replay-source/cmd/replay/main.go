package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"projectreplay/internal/replay"
	"runtime"
	"syscall"
	"time"
)

func main() {
	exe, _ := os.Executable()
	defaultDir := filepath.Join(filepath.Dir(exe), "replay-data")
	listen := flag.String("listen", "127.0.0.1:7788", "监听地址；Linux Agent 在局域网使用 0.0.0.0:7788")
	data := flag.String("data", defaultDir, "数据目录")
	role := flag.String("role", "director", "director 或 agent")
	cs2Cfg := flag.String("cs2-cfg", "", "本机 CS2 game/csgo/cfg 绝对路径；默认自动检测 Steam 安装")
	noBrowser := flag.Bool("no-browser", false, "不打开浏览器")
	version := flag.Bool("version", false, "显示版本")
	managed := flag.Bool("scoredeck-managed", false, "ScoreDeck managed stdin lifecycle")
	embedOrigin := flag.String("scoredeck-origin", "", "Exact loopback ScoreDeck origin")
	flag.Parse()
	if *embedOrigin != "" {
		u, err := url.Parse(*embedOrigin)
		if err != nil || u.Scheme != "http" || (u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost") || u.Port() == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
			log.Fatal("invalid ScoreDeck origin")
		}
	}
	if *version {
		fmt.Println("Project Replay", replay.Version, runtime.GOOS, runtime.GOARCH)
		return
	}
	ln, e := net.Listen("tcp", *listen)
	if e != nil {
		log.Fatal(e)
	}
	app, e := replay.New(*data, *role)
	if e != nil {
		log.Fatal(e)
	}
	if runtime.GOOS == "linux" && *role == "agent" || runtime.GOOS == "windows" && *role == "director" {
		if err := app.InstallLocalGSI(*cs2Cfg, ln.Addr().String()); err != nil {
			log.Printf("自动安装 GSI：%v", err)
		}
	}
	if *embedOrigin != "" {
		originURL, _ := url.Parse(*embedOrigin)
		app.EmbedOrigin = "http://127.0.0.1:" + originURL.Port() + " http://localhost:" + originURL.Port()
	}
	app.Start()
	_, port, _ := net.SplitHostPort(ln.Addr().String())
	address := "http://127.0.0.1:" + port + "/"
	fmt.Printf("Project Replay %s · %s/%s · %s\n界面：%s\n数据：%s\n关闭程序：Ctrl+C\n", replay.Version, runtime.GOOS, runtime.GOARCH, *role, address, *data)
	baseHandler := app.Handler()
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if *managed && r.URL.Path == "/scoredeck/config" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"origin": *embedOrigin})
			return
		}
		if *managed && r.URL.Path == "/scoredeck/health" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{"ok": true, "version": replay.Version, "instance": os.Getenv("SD_INSTANCE")})
			return
		}
		baseHandler.ServeHTTP(w, r)
	})
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 << 10}
	go func() {
		if e := server.Serve(ln); e != nil && e != http.ErrServerClosed {
			log.Println(e)
		}
	}()
	if !*noBrowser {
		var cmd *exec.Cmd
		if runtime.GOOS == "windows" {
			cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", address)
		} else {
			cmd = exec.Command("xdg-open", address)
		}
		if e := cmd.Start(); e == nil {
			go cmd.Wait()
		}
	}
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	parentDone := make(chan struct{})
	if *managed {
		go func() {
			scanner := bufio.NewScanner(os.Stdin)
			for scanner.Scan() {
				if scanner.Text() == "shutdown" {
					break
				}
			}
			close(parentDone)
		}()
	}
	select {
	case <-signals:
	case <-parentDone:
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	server.Shutdown(ctx)
	app.Close()
}
