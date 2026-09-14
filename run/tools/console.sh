#!/bin/bash
# usage: tools/console.sh "seed=7&shot=1&at=3"   → JSON с title, crash, exceptions, console
exec node "$(dirname "$0")/cdp.mjs" --query "$1" ${PAGE:+--page "$PAGE"}
