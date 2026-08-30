#!/bin/sh
#
# PREISORA iOS — one-command setup.
#
#   ./bootstrap.sh              generate the Xcode project and open it
#   ./bootstrap.sh --no-open    generate only (for CI or scripted use)
#
# Safe to re-run from any state: it reuses an xcodegen already on your PATH or
# already extracted here, and never stops on an interactive prompt.
#
set -eu

XCODEGEN_ZIP_URL="https://github.com/yonaskolb/XcodeGen/releases/latest/download/xcodegen.zip"

OPEN_PROJECT=1
for arg in "$@"; do
    case "$arg" in
        --no-open) OPEN_PROJECT=0 ;;
        -h|--help)
            sed -n '3,9p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "bootstrap.sh: unknown option '$arg' (try --help)" >&2
            exit 2
            ;;
    esac
done

if [ "$(uname -s)" != "Darwin" ]; then
    echo "bootstrap.sh: this needs macOS with Xcode — the iOS app cannot be built elsewhere." >&2
    echo "The backend (../backend) does run on Linux; see ../README.md." >&2
    exit 1
fi

# Work from this script's directory, whatever the caller's cwd is.
cd "$(dirname "$0")"

if [ ! -f project.yml ]; then
    echo "bootstrap.sh: project.yml not found — run this from inside the repo's ios/ directory." >&2
    exit 1
fi

# 1. Find XcodeGen: PATH (Homebrew) > already extracted here > download.
if command -v xcodegen >/dev/null 2>&1; then
    XCODEGEN="xcodegen"
    echo "==> Using xcodegen from PATH ($(xcodegen --version 2>/dev/null | head -1))"
elif [ -x ./xcodegen/bin/xcodegen ]; then
    XCODEGEN="./xcodegen/bin/xcodegen"
    echo "==> Using the XcodeGen already extracted in ios/xcodegen"
else
    echo "==> Downloading XcodeGen"
    curl -fL --progress-bar -o xcodegen.zip "$XCODEGEN_ZIP_URL"
    # -o overwrites without prompting, so a re-run never blocks on "replace ...?"
    unzip -o -q xcodegen.zip
    rm -f xcodegen.zip
    XCODEGEN="./xcodegen/bin/xcodegen"
    [ -x "$XCODEGEN" ] || { echo "bootstrap.sh: extraction did not produce $XCODEGEN" >&2; exit 1; }
fi

# 2. Generate the project (Preisora.xcodeproj is gitignored — project.yml is the source of truth).
echo "==> Generating Preisora.xcodeproj"
"$XCODEGEN" generate

# 3. Open it, unless asked not to.
echo ""
echo "Done. The app starts in Demo Mode — no backend needed."
echo "In the simulator: Home > Scannen > enter GTIN 4012345000016 (Vollmilch)."
echo ""
if [ "$OPEN_PROJECT" -eq 1 ]; then
    echo "==> Opening Xcode (select the Preisora scheme, then Cmd-R)"
    open Preisora.xcodeproj
else
    echo "Next: open Preisora.xcodeproj, select the Preisora scheme, press Cmd-R."
fi
