#!/usr/bin/env bash
# Fetch the source anatomy meshes the rig is built from.
#
# Source: BodyParts3D (DBCLS, CC BY-SA 2.1 JP) + Z-Anatomy (CC BY-SA 4.0),
# via the decimated, named glTF export published in JohanBellander/BodyExplorer
# (code MIT). Using that export rather than the raw BodyParts3D archive saves
# ~200MB of download and the whole FMA-ID-to-name mapping problem — its meshes
# are already decimated to ~4k faces and named in plain English.
#
# These files are NOT committed: ~35MB of third-party data that only the asset
# pipeline needs. Only the built public/models/anatomy.glb ships.
#
# Usage: tools/fetch-source.sh [dest-dir]      (default: .artifacts/anatomy-src)

set -euo pipefail

DEST="${1:-$(dirname "$0")/../.artifacts/anatomy-src}"
BASE="https://raw.githubusercontent.com/JohanBellander/BodyExplorer/main"

mkdir -p "$DEST"
cd "$DEST"

for f in public/anatomy.glb public/skeleton.glb public/mesh_mapping.json; do
  out="$(basename "$f")"
  if [ -f "$out" ]; then
    echo "have  $out"
  else
    echo "fetch $out"
    curl -fsSL --retry 3 -o "$out" "$BASE/$f"
  fi
done

echo
echo "source ready in: $(pwd)"
ls -la
echo
echo "next: npm run build:anatomy"
