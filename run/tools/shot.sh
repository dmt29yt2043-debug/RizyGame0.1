#!/bin/bash
# usage: tools/shot.sh OUT.png "seed=7&shot=1&at=5[&lane=0][&pose=jump|slide][&cam=title][&q=high]" [W] [H]
#        PAGE=/run/other.html tools/shot.sh OUT.png "query"
exec node "$(dirname "$0")/cdp.mjs" --out "$1" --query "$2" --w "${3:-1280}" --h "${4:-720}" ${PAGE:+--page "$PAGE"}
