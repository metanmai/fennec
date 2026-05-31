# fennec-notifier — Helper LaunchAgent build (Plan 01-08 Task 3).
#
# Cross-compile targets mirror the shim Makefile pattern (Plan 01-07).
# -ldflags="-s -w" strips debug symbols + DWARF for ~30% size reduction;
# combined with the stdlib-only design we land well under the 3MB
# acceptance bar.
#
# Go toolchain path: the goenv shim is broken on the dev machine; we
# use the explicit goenv-managed binary path. Override with `make GO=...`
# in CI or contributor builds with a different layout.

GO ?= /opt/homebrew/bin/.goenv/versions/1.25.7/bin/go
LDFLAGS = -s -w
BUILD_DIR = build
BINARY = fennec-notifier

.PHONY: all clean darwin-arm64 darwin-amd64 linux-amd64 windows-amd64

all: darwin-arm64 darwin-amd64 linux-amd64 windows-amd64

darwin-arm64:
	@mkdir -p $(BUILD_DIR)
	GOOS=darwin GOARCH=arm64 $(GO) build -ldflags="$(LDFLAGS)" -o $(BUILD_DIR)/$(BINARY)-darwin-arm64 .

darwin-amd64:
	@mkdir -p $(BUILD_DIR)
	GOOS=darwin GOARCH=amd64 $(GO) build -ldflags="$(LDFLAGS)" -o $(BUILD_DIR)/$(BINARY)-darwin-amd64 .

linux-amd64:
	@mkdir -p $(BUILD_DIR)
	GOOS=linux GOARCH=amd64 $(GO) build -ldflags="$(LDFLAGS)" -o $(BUILD_DIR)/$(BINARY)-linux-amd64 .

windows-amd64:
	@mkdir -p $(BUILD_DIR)
	GOOS=windows GOARCH=amd64 $(GO) build -ldflags="$(LDFLAGS)" -o $(BUILD_DIR)/$(BINARY)-windows-amd64.exe .

clean:
	rm -rf $(BUILD_DIR)
