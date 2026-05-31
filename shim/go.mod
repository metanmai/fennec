module github.com/fennec-dev/fennec/shim

go 1.23

// stdlib-only — threat T-07-SC honored.
// The shim depends on net/http, io, os, time, bytes — zero external requires.
require ()
