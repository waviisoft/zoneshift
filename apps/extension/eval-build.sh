#!/bin/sh
# Builds every variant evaluated for #34 into /tmp/zs-ext/<variant>:
#   current           the shipping annotator at 7a67bda
#   mark|run|inplace  shadow-DOM layouts (see lib/shadow-annotator.ts)
#   *-hidden          original kept slotted in a zero-size, aria-hidden box
#   mark-closed       closed shadow roots;  mark-element  <style> instead of adoptedStyleSheets
set -e
cd "$(dirname "$0")"
for v in ${VARIANTS:-current mark mark-hidden run run-hidden inplace inplace-hidden mark-closed mark-element}; do
  render=${v%%-*}; mode=open; style=adopted; original=unslotted
  case $v in *-closed) mode=closed;; *-element) style=element;; *-hidden) original=hidden;; esac
  VITE_ZS_RENDER=$render VITE_ZS_SHADOW_MODE=$mode VITE_ZS_STYLE=$style VITE_ZS_ORIGINAL=$original npx wxt build >/dev/null
  rm -rf /tmp/zs-ext/$v && mkdir -p /tmp/zs-ext && cp -r .output/chrome-mv3 /tmp/zs-ext/$v
done
npx wxt build >/dev/null
