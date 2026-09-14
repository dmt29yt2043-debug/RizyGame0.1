#!/bin/bash
# usage: tools/eval.sh "seed=7&shot=1&at=3" "JSON.stringify(RUN.renderer.info.render)"
exec node "$(dirname "$0")/cdp.mjs" --query "$1" --eval "$2" ${PAGE:+--page "$PAGE"}
