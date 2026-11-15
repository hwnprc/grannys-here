#!/usr/bin/env bash
# Assemble the one deployable site into dist-site/ and (optionally) deploy it.
#
#   scripts/build_site.sh            build only
#   scripts/build_site.sh --deploy   build, then `vercel deploy --prod`
#
# Layout (one Vercel project, grannys-here):
#   /                     the band companion (companion/public, index = vexo.html)
#   /api/*                serverless: World Labs key lives in the project's env
#   /vexo-open-kit/...    the kit's browser modules the companion imports
#   /web/*                memory viewer, family page, walkable world
#   /memories/*           the Stow Lake memory: json, panorama, splat, thumbnail
#
# Never copied: .env, audio.wav / recordings (a real person's voice), the Python scripts.
set -euo pipefail
R="$(cd "$(dirname "$0")/.." && pwd)"
D="$R/dist-site"
C="$R/companion"
[ -d "$C/vexo-open-kit" ] || { echo "✗ companion/vexo-open-kit missing — run: (cd companion && npm run setup-kit)"; exit 1; }

rm -rf "$D"
mkdir -p "$D/api" "$D/web" "$D/memories/sunday-park" "$D/vexo-open-kit/js/src" "$D/vexo-open-kit/dashboard/speech"
cp "$C"/public/* "$D/"
cp "$D/vexo.html" "$D/index.html"
cp "$C"/api/*.js "$D/api/"
cp "$C"/vercel.json "$D/vercel.json"
printf '{ "type": "module" }\n' > "$D/package.json"
cp -R "$C"/vexo-open-kit/js/src/. "$D/vexo-open-kit/js/src/"
cp "$C"/vexo-open-kit/dashboard/speech/deepgram.js "$D/vexo-open-kit/dashboard/speech/"
cp "$R"/web/viewer.html "$R"/web/family.html "$R"/web/world.html "$D/web/"
cp "$R"/memories/index.json "$D/memories/"
for f in memory.json pano.jpg world.spz world_thumb.jpg; do cp "$R/memories/sunday-park/$f" "$D/memories/sunday-park/"; done

# refuse to ship anything that must stay private
if find "$D" \( -name '*.wav' -o -name '*.ogg' -o -name '*.opus' -o -name '.env' \) | grep -q .; then
  echo "✗ private file in the bundle — aborting"; exit 1; fi
if grep -rIqE '(DEEPGRAM|OPENAI|WORLDLABS|ELEVENLABS)_API_KEY *= *[A-Za-z0-9_-]{8,}' "$D"; then
  echo "✗ an API key is in the bundle — aborting"; exit 1; fi

echo "✓ built $D ($(du -sh "$D" | cut -f1), $(find "$D" -type f | wc -l | tr -d ' ') files)"
if [ "${1:-}" = "--deploy" ]; then
  cd "$D" && vercel link --yes --project grannys-here >/dev/null 2>&1 || true
  vercel deploy --prod --yes
fi
