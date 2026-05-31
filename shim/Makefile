# fennec-hook — cross-compile shim binaries for the four supported
# platforms. Phase 1 only ships the macOS binary in the signed .pkg
# (Plan 01-09); the Linux + Windows targets exist so Phase 5 cross-
# platform polish can pick them up without further Makefile churn.
#
# -ldflags="-s -w" strips symbol + DWARF info, halving binary size.
# Resulting darwin-arm64 binary is ~5.1MB. The Go runtime + net/http
# minimum floor on darwin-arm64 is ~5MB irreducibly; getting below 3MB
# would require dropping net/http for raw net.Dial + manual HTTP
# serialisation, which is more complexity than the shim warrants for
# Phase 1. The DAE-18 ≤15ms TIME contract is the load-bearing budget,
# not the file-size budget. Plan 01-07 deviation #1 records this.
#
# The Go binary is referenced via an absolute path because the goenv
# shim on this host is broken — `which go` returns an error even
# though the toolchain is installed. Using $GO via env override
# (`make GO=/path/to/go darwin-arm64`) lets CI / signed-build pipelines
# point at any Go install.

GO ?= /opt/homebrew/bin/.goenv/versions/1.25.7/bin/go
BUILD_DIR := build
LDFLAGS := -ldflags=-s -w

.PHONY: all darwin-arm64 darwin-amd64 linux-amd64 windows-amd64 test clean

all: darwin-arm64 darwin-amd64 linux-amd64 windows-amd64

darwin-arm64:
	@mkdir -p $(BUILD_DIR)
	GOOS=darwin GOARCH=arm64 $(GO) build "$(LDFLAGS)" -o $(BUILD_DIR)/fennec-hook-darwin-arm64 .

darwin-amd64:
	@mkdir -p $(BUILD_DIR)
	GOOS=darwin GOARCH=amd64 $(GO) build "$(LDFLAGS)" -o $(BUILD_DIR)/fennec-hook-darwin-amd64 .

linux-amd64:
	@mkdir -p $(BUILD_DIR)
	GOOS=linux GOARCH=amd64 $(GO) build "$(LDFLAGS)" -o $(BUILD_DIR)/fennec-hook-linux-amd64 .

windows-amd64:
	@mkdir -p $(BUILD_DIR)
	GOOS=windows GOARCH=amd64 $(GO) build "$(LDFLAGS)" -o $(BUILD_DIR)/fennec-hook-windows-amd64.exe .

test:
	$(GO) test -v ./...

clean:
	rm -rf $(BUILD_DIR)
