#!/usr/bin/env bash
# Wraps a binary file (emulator, BIOS, kernel, file system) in a JavaScript file
# as base64. Some web hosts refuse or drop .wasm, .bin and extensionless files,
# but every host serves .js, and most compress it, so the transfer stays small.
# terminal/terminal.js fetches these files and decodes them.
#
# Usage: pack.sh INPUT NAME OUTPUT.js
#   NAME is the key terminal.js looks the file up by, e.g. "v86.wasm".

set -euo pipefail

if [ $# -ne 3 ]; then
  echo "usage: $0 INPUT NAME OUTPUT.js" >&2
  exit 2
fi
input=$1 name=$2 output=$3

{
  printf '// %s as base64 (made by terminal/build/pack.sh)\n' "$name"
  printf "(self.lpiTerminalFiles ||= {})['%s'] = '" "$name"
  base64 -w0 "$input"
  printf "';\n"
} > "$output"
