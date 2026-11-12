// Command ecclient is the PC stand-in for the Kiwimake phone's Easy Connect side, used by
// server/scripts/easy-connect-check.mjs. It calls this package exactly as the phone's native
// module calls the gomobile-bound bridge (Ghostex GhostexNativeModule.kt): UseClientKeyFile once,
// then StartForward(id, address, remotePort), which returns a 127.0.0.1 port that tunnels to the
// companion through tailcat.
//
// stdin, line 1: the tailcat address (tc…) from the Easy Connect code (kept off the command line).
// stdout: "CLIENTKEY nodekey:…", then "LOCALPORT <n>", then "PATH <json>" once the bridge has
// measured the link (relay or direct). Each later stdin line "reconnect" calls StartForward again,
// as the phone does when its tunnel dropped (the bridge probes the tunnel it has and rebuilds it
// if it no longer answers), and prints "LOCALPORT <n>" or "ERROR <message>". Closing stdin ends it.
package main

import (
	"bufio"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"ghostex.local/tailcatbridge"
)

const forwardID = "anyapp-check"

func main() {
	keyFile := flag.String("key", "", "file holding this client's tailcat key (created on first use)")
	port := flag.Int("port", 8787, "the companion port the tunnel carries")
	flag.Parse()
	lines := bufio.NewScanner(os.Stdin)
	if !lines.Scan() {
		fail("no address on stdin")
	}
	addr := strings.TrimSpace(lines.Text())
	pub, err := tailcatbridge.UseClientKeyFile(*keyFile)
	if err != nil {
		fail("client key: %v", err)
	}
	fmt.Println("CLIENTKEY", pub)
	forward(addr, *port)
	go func() {
		for i := 0; i < 40; i++ {
			time.Sleep(500 * time.Millisecond)
			if p := tailcatbridge.ForwardPath(forwardID); p != "" {
				fmt.Println("PATH", p)
				return
			}
		}
	}()
	for lines.Scan() {
		if strings.TrimSpace(lines.Text()) == "reconnect" {
			forward(addr, *port)
		}
	}
	tailcatbridge.StopAll()
}

func forward(addr string, port int) {
	local, err := tailcatbridge.StartForward(forwardID, addr, port)
	if err != nil {
		fmt.Println("ERROR", strings.ReplaceAll(err.Error(), "\n", " "))
		return
	}
	fmt.Println("LOCALPORT", local)
}

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "ecclient: "+format+"\n", args...)
	os.Exit(1)
}
