#!/usr/bin/env bash
#
# Cuts a GitHub release for this plugin, which is the only thing BRAT actually reads:
# it downloads main.js, manifest.json and styles.css from a release's *assets*, not
# from the files committed in the repo.
#
# By default it bumps the patch version, so running it twice gives you 0.0.2 and then
# 0.0.3 rather than trying to overwrite 0.0.1 forever.
#
# usage:
#   GITHUB_TOKEN=ghp_... bin/release.sh                 # bump the patch version and release it
#   GITHUB_TOKEN=ghp_... bin/release.sh --minor         # 0.0.3 -> 0.1.0
#   GITHUB_TOKEN=ghp_... bin/release.sh --major         # 0.1.0 -> 1.0.0
#   GITHUB_TOKEN=ghp_... bin/release.sh 1.2.3           # release an explicit version
#   GITHUB_TOKEN=ghp_... bin/release.sh --no-bump       # release whatever manifest.json says
#   GITHUB_TOKEN=ghp_... bin/release.sh --dry-run       # say what it would do, change nothing
#
# options:
#   --major | --minor | --patch   which part to bump (default: patch)
#   --no-bump      leave the version alone and release the one in manifest.json
#   --no-commit    write the bumped version files but don't commit or push them
#   --no-build     skip `npm test && npm run build`, use main.js as it stands
#   --prerelease   mark the release as a pre-release
#   --dry-run      nothing written, tagged, pushed or published
#
# The token needs `repo` scope (classic) or Contents: read and write (fine-grained).
#
# @author Josh Long

set -euo pipefail

ASSETS=(main.js manifest.json styles.css)

# Files carrying the version number. versions.json is handled separately because it's a
# map of plugin version -> minimum Obsidian version, not a single field.
VERSIONED=(manifest.json package.json)

GITHUB_TOKEN=${GITHUB_TOKEN:-${GITHUB_PERSONAL_ACCESS_TOKEN}}

BUILD=1
PRERELEASE=false
DRY_RUN=0
COMMIT=1
BUMP=patch
TAG=""

while [ $# -gt 0 ]; do
	case "$1" in
	--major | --minor | --patch) BUMP="${1#--}" ;;
	--no-bump) BUMP=none ;;
	--no-commit) COMMIT=0 ;;
	--no-build) BUILD=0 ;;
	--prerelease) PRERELEASE=true ;;
	--dry-run) DRY_RUN=1 ;;
	-h | --help)
		# The header comment above is the help text, up to the first line that isn't one.
		awk 'NR > 1 && !/^#/ { exit } NR > 1 { print substr($0, 3) }' "$0"
		exit 0
		;;
	-*)
		echo "unknown option: $1" >&2
		exit 1
		;;
	*) TAG="$1" ;;
	esac
	shift
done

die() {
	echo "error: $*" >&2
	exit 1
}

note() { echo "==> $*"; }

# Everything below assumes we're at the top of the repo, whatever directory you ran this from.
cd "$(git rev-parse --show-toplevel 2>/dev/null)" || die "not inside a git repository"

TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
[ -n "$TOKEN" ] || die "set GITHUB_TOKEN (or GH_TOKEN) to a personal access token"
command -v python3 >/dev/null || die "python3 is needed to read the JSON responses"

# Works for both git@github.com:owner/repo.git and https://github.com/owner/repo.git
ORIGIN="$(git remote get-url origin)" || die "no 'origin' remote"
REPO="$(printf '%s' "$ORIGIN" | sed -E 's#^(git@github\.com:|https://github\.com/)##; s#\.git$##')"
case "$REPO" in
*/*) ;;
*) die "origin doesn't look like a GitHub repo: $ORIGIN" ;;
esac

# ------------------------------------------------------------- picking a version

json_field() { python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$1" "$2"; }

MANIFEST_VERSION="$(json_field manifest.json version)"
MIN_APP_VERSION="$(json_field manifest.json minAppVersion)"

# The manifest can lag behind reality — someone tags by hand, or a bump commit never
# lands — so bump from whichever is higher, the manifest or the newest existing tag.
# That's what stops a rerun from landing on a version that's already been published.
next_version() {
	MANIFEST_VERSION="$MANIFEST_VERSION" BUMP="$BUMP" python3 - <<'PY'
import os, re, subprocess

SEMVER = re.compile(r'^(\d+)\.(\d+)\.(\d+)$')

def parse(v):
    m = SEMVER.match(v)
    return tuple(int(p) for p in m.groups()) if m else None

manifest = parse(os.environ["MANIFEST_VERSION"])
if manifest is None:
    raise SystemExit("manifest.json version isn't a plain major.minor.patch — pass an explicit version")

tags = subprocess.run(["git", "tag", "--list"], capture_output=True, text=True).stdout.split()
versions = [v for v in (parse(t.lstrip("v")) for t in tags) if v]
major, minor, patch = max([manifest] + versions)

bump = os.environ["BUMP"]
if bump == "major":
    major, minor, patch = major + 1, 0, 0
elif bump == "minor":
    minor, patch = minor + 1, 0
else:
    patch += 1

print(f"{major}.{minor}.{patch}")
PY
}

if [ -n "$TAG" ]; then
	# An explicit version wins, and it's on you to make it sane; we only check it's new.
	[ "$BUMP" = patch ] || die "pass either a version or --major/--minor/--patch, not both"
	BUMP=none
	NEW_VERSION="$TAG"
elif [ "$BUMP" = none ]; then
	NEW_VERSION="$MANIFEST_VERSION"
else
	NEW_VERSION="$(next_version)"
fi

TAG="$NEW_VERSION"

if [ "$NEW_VERSION" != "$MANIFEST_VERSION" ]; then
	note "bumping $MANIFEST_VERSION -> $NEW_VERSION"
else
	note "releasing $MANIFEST_VERSION as it stands"
fi

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && [ "$BUMP" != none ]; then
	die "tag $TAG already exists — that's a bug in the bump, not something to overwrite"
fi

note "releasing $REPO $TAG"
[ "$DRY_RUN" -eq 1 ] && note "dry run: nothing will be written, pushed or published"

if [ -n "$(git status --porcelain)" ]; then
	echo "warning: working tree is dirty; the release is built from what's on disk" >&2
fi

if [ "$BUILD" -eq 1 ]; then
	note "building"
	npm test
	npm run build
fi

for asset in "${ASSETS[@]}"; do
	[ -f "$asset" ] || die "$asset is missing — run npm run build"
done

# -------------------------------------------------------- writing the new version

# Rewrites the version in place with a regex rather than reserialising the file, so the
# hand-rolled formatting (tabs, one-line arrays) survives the bump.
set_version() {
	FILE="$1" NEW="$2" python3 - <<'PY'
import os, re
path, new = os.environ["FILE"], os.environ["NEW"]
src = open(path).read()
out, n = re.subn(r'("version"\s*:\s*")[^"]*(")', lambda m: m.group(1) + new + m.group(2), src, count=1)
if n != 1:
    raise SystemExit(f"no version field found in {path}")
open(path, "w").write(out)
PY
}

# versions.json tells Obsidian which plugin versions work with which app versions, so
# every released version needs a row in it.
record_version() {
	NEW="$1" MIN_APP="$2" python3 - <<'PY'
import json, os
new, min_app = os.environ["NEW"], os.environ["MIN_APP"]
with open("versions.json") as f:
    versions = json.load(f)
versions[new] = min_app
with open("versions.json", "w") as f:
    json.dump(versions, f, indent="\t")
    f.write("\n")
PY
}

if [ "$NEW_VERSION" != "$MANIFEST_VERSION" ] || ! python3 -c 'import json,sys;sys.exit(sys.argv[1] in json.load(open("versions.json")))' "$NEW_VERSION"; then
	if [ "$DRY_RUN" -eq 1 ]; then
		note "would set the version to $NEW_VERSION in ${VERSIONED[*]} and versions.json"
	else
		for file in "${VERSIONED[@]}"; do
			note "setting $file to $NEW_VERSION"
			set_version "$file" "$NEW_VERSION"
		done
		note "recording $NEW_VERSION -> Obsidian $MIN_APP_VERSION in versions.json"
		record_version "$NEW_VERSION" "$MIN_APP_VERSION"
	fi
fi

# The tag has to point at a commit that already contains the bumped manifest: BRAT reads
# the manifest out of the release, and the CI workflow refuses a tag that disagrees with it.
BUMPED=(manifest.json package.json versions.json "${ASSETS[@]}")

if [ "$COMMIT" -eq 1 ] && [ "$DRY_RUN" -eq 1 ]; then
	note "would commit and push the version bump"
elif [ "$COMMIT" -eq 1 ]; then
	git add -- "${BUMPED[@]}"
	if git diff --cached --quiet; then
		note "nothing to commit — the version files are already up to date"
	else
		note "committing the version bump"
		git commit -m "release $NEW_VERSION"
		note "pushing to origin"
		git push origin HEAD
	fi
fi

# ---------------------------------------------------------------- the git tag

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
	note "tag $TAG already exists locally"
elif [ "$DRY_RUN" -eq 1 ]; then
	note "would tag HEAD as $TAG"
else
	note "tagging HEAD as $TAG"
	git tag "$TAG"
fi

if git ls-remote --exit-code --tags origin "$TAG" >/dev/null 2>&1; then
	note "tag $TAG is already on origin"
elif [ "$DRY_RUN" -eq 1 ]; then
	note "would push tag $TAG to origin"
else
	note "pushing tag $TAG"
	git push origin "$TAG"
fi

# ------------------------------------------------------------- the GitHub API

API="https://api.github.com"
BODY="$(mktemp)"
trap 'rm -f "$BODY"' EXIT

# Runs a GitHub API call, prints the HTTP status, and leaves the response body in $BODY.
# It prints the status rather than assigning it because every caller wraps this in $( ),
# and a variable set inside a subshell doesn't make it back out.
api() {
	local method="$1" url="$2"
	shift 2
	curl -sS -o "$BODY" -w '%{http_code}' \
		-X "$method" \
		-H "Authorization: Bearer $TOKEN" \
		-H "Accept: application/vnd.github+json" \
		-H "X-GitHub-Api-Version: 2022-11-28" \
		"$@" \
		"$url"
}

# Pulls one field out of the JSON body of the last response.
field() { python3 -c 'import sys,json;print(json.load(sys.stdin).get(sys.argv[1],""))' "$1" <"$BODY"; }

STATUS="$(api GET "$API/repos/$REPO/releases/tags/$TAG")"

if [ "$STATUS" = "401" ] || [ "$STATUS" = "403" ]; then
	die "GitHub rejected the token (HTTP $STATUS): $(cat "$BODY")
the token needs 'repo' scope (classic) or Contents: read and write (fine-grained)"
elif [ "$STATUS" = "200" ]; then
	RELEASE_ID="$(field id)"
	note "release $TAG already exists (#$RELEASE_ID) — replacing its assets"

	# GitHub refuses a second asset with the same name, so clear the old ones out first.
	OLD_ASSETS="$(python3 -c 'import sys,json;[print(a["id"],a["name"]) for a in json.load(sys.stdin)["assets"]]' <"$BODY")"
	while read -r asset_id asset_name; do
		[ -n "$asset_id" ] || continue
		if [ "$DRY_RUN" -eq 1 ]; then
			note "would delete existing asset $asset_name"
		else
			note "deleting existing asset $asset_name"
			STATUS="$(api DELETE "$API/repos/$REPO/releases/assets/$asset_id")"
			[ "$STATUS" = "204" ] || die "could not delete $asset_name (HTTP $STATUS): $(cat "$BODY")"
		fi
	done <<<"$OLD_ASSETS"
elif [ "$STATUS" = "404" ]; then
	PAYLOAD="$(TAG="$TAG" PRERELEASE="$PRERELEASE" python3 -c '
import json, os
print(json.dumps({
    "tag_name": os.environ["TAG"],
    "name": os.environ["TAG"],
    "draft": False,  # BRAT cannot see draft releases
    "prerelease": os.environ["PRERELEASE"] == "true",
    "generate_release_notes": True,
}))')"

	if [ "$DRY_RUN" -eq 1 ]; then
		note "would create release $TAG"
		RELEASE_ID="dry-run"
	else
		note "creating release $TAG"
		STATUS="$(api POST "$API/repos/$REPO/releases" -H 'Content-Type: application/json' -d "$PAYLOAD")"
		[ "$STATUS" = "201" ] || die "could not create the release (HTTP $STATUS): $(cat "$BODY")"
		RELEASE_ID="$(field id)"
	fi
else
	die "could not look up the release (HTTP $STATUS): $(cat "$BODY")"
fi

# ---------------------------------------------------------------- the assets

for asset in "${ASSETS[@]}"; do
	if [ "$DRY_RUN" -eq 1 ]; then
		note "would upload $asset"
		continue
	fi
	note "uploading $asset"
	STATUS="$(api POST \
		"https://uploads.github.com/repos/$REPO/releases/$RELEASE_ID/assets?name=$asset" \
		-H 'Content-Type: application/octet-stream' \
		--data-binary "@$asset")"
	[ "$STATUS" = "201" ] || die "could not upload $asset (HTTP $STATUS): $(cat "$BODY")"
done

if [ "$DRY_RUN" -eq 1 ]; then
	note "dry run finished"
else
	note "done: https://github.com/$REPO/releases/tag/$TAG"
	note "in Obsidian: BRAT → Add beta plugin → $REPO"
fi
