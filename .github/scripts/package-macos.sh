#!/bin/bash
set -euo pipefail

if [ "$#" -ne 4 ]; then
    echo "Usage: package-macos.sh <publish-dir> <output-dir> <work-dir> <version>" >&2
    exit 1
fi

publish_dir=$1
output_dir=$2
work_dir=$3
version=$4

if [[ ! "$version" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]]; then
    echo "Invalid macOS bundle version: $version" >&2
    exit 1
fi
if [ ! -x "$publish_dir/Mockarium.Desktop" ]; then
    echo "Published application executable is missing or not executable." >&2
    exit 1
fi
if [ -e "$output_dir/Mockarium.app" ] || [ -e "$work_dir/Mockarium.iconset" ]; then
    echo "Bundle or icon work directory already exists." >&2
    exit 1
fi

bundle="$output_dir/Mockarium.app/Contents"
iconset="$work_dir/Mockarium.iconset"
mkdir -p "$bundle/MacOS" "$bundle/Resources" "$iconset"
cp -R "$publish_dir/." "$bundle/MacOS/"
cp src/Mockarium.Desktop/Packaging/Info.plist "$bundle/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $version" "$bundle/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $version" "$bundle/Info.plist"

sips -s format png src/Mockarium.Desktop/Packaging/Icon.svg --out "$work_dir/icon.png" >/dev/null
for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$work_dir/icon.png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
    doubled=$((size * 2))
    sips -z "$doubled" "$doubled" "$work_dir/icon.png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$bundle/Resources/Mockarium.icns"
plutil -lint "$bundle/Info.plist"
