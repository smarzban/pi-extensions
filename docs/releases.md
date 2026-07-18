# Releases

Each package under `packages/*` is published to npm (org: **pi-extensions**) **independently**, with
its own version and its own git tag. Same pattern as
[empanel](https://github.com/smarzban/empanel): **tag → GitHub Actions → OIDC trusted publishing**.
No long-lived npm token in the repo.

## Tag scheme

Tags are **per-package**: `pi-<name>-vX.Y.Z`. The tag names which package to publish and at which
version.

| Tag | Publishes |
|-----|-----------|
| `pi-pacman-v0.1.1` | `packages/pi-pacman` → `@pi-extensions/pi-pacman@0.1.1` |
| `pi-statusline-v0.2.0` | `packages/pi-statusline` → `@pi-extensions/pi-statusline@0.2.0` |

`release.yml` parses the package directory and version from the tag, so **adding a package needs no
workflow change**: just tag it once the package exists under `packages/`.

## One-time setup (maintainer, per package)

Do this **once per package**. Until it is done, that package's tags build but cannot publish.

### 1. First publish (create the package under the org)

npm only lets you attach a Trusted Publisher to a package that **already exists**.

With **passkey** 2FA (no 6-digit OTP), use a granular access token that can publish to the
`pi-extensions` org and has **Bypass two-factor authentication** enabled:

```bash
npm config set //registry.npmjs.org/:_authToken=npm_YOUR_TOKEN

cd packages/pi-pacman        # or packages/pi-statusline
npm publish --access public
```

(`publishConfig.access` is already `"public"`, required for scoped packages.)

If you use an authenticator app instead:

```bash
npm publish --access public --otp=XXXXXX   # 6 digits only, not npm_…
```

### 2. Link Trusted Publisher on npmjs.com

1. Open the package's page → **Settings** → **Trusted Publisher**
   (e.g. https://www.npmjs.com/package/@pi-extensions/pi-pacman)
2. Add GitHub Actions:
   - **Organization or user:** `smarzban`
   - **Repository:** `pi-extensions`
   - **Workflow filename:** `release.yml` (exact; the same file publishes every package)
   - **Environment:** leave empty
3. Save

After this, CI can publish that package with **no OTP and no `NPM_TOKEN` secret**.

### 3. (Recommended) Protect release tags on GitHub

Repo → **Settings** → **Tags** / rulesets: only you can create tags matching `pi-*-v*`.
The release workflow also refuses tags whose commit is not on `main`, but tag protection is the primary control.

## Cut a release

1. Bump `version` in that package's `package.json` (e.g. `packages/pi-pacman` → `0.1.1`)
2. Commit on `main` and push
3. Tag `pi-<name>-vX.Y.Z` matching that version and push the tag:

```bash
git tag pi-pacman-v0.1.1
git push origin pi-pacman-v0.1.1
```

4. Watch **Actions → release**. On success:

```bash
pi install npm:@pi-extensions/pi-pacman
# or pin
pi install npm:@pi-extensions/pi-pacman@0.1.1
```

## What the workflow does

File: [`.github/workflows/release.yml`](../.github/workflows/release.yml)

1. Trigger on `pi-*-v*` tags
2. Resolve `packages/<name>` + version from the tag (fail on malformed / unknown package)
3. Assert the tagged commit is on `main`
4. Assert the tag version == that package's `package.json` `version`
5. `npm pack --dry-run`
6. `npm publish` from `packages/<name>` via OIDC

## Install options (users)

```bash
# One package (usual)
pi install npm:@pi-extensions/pi-pacman
pi install npm:@pi-extensions/pi-statusline
pi install /path/to/pi-extensions/packages/pi-pacman

# Whole monorepo (every package in root pi.extensions)
pi install git:github.com/smarzban/pi-extensions
```
