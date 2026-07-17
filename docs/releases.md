# Releases

How `pi-pacman` gets to npm. Same pattern as [empanel](https://github.com/smarzban/empanel):
**tag → GitHub Actions → OIDC trusted publishing**. No long-lived npm token in the repo.

## One-time setup (maintainer)

### 1. Reservation publish (OTP, once)

npm only lets you attach a Trusted Publisher to a package that **already exists**.

```bash
cd packages/pi-pacman
# use a real 6-digit authenticator code — not an npm_ token
npm publish --access public --otp=XXXXXX
```

If `0.1.0` is what you want live first, publish that. If you prefer a stub:

```bash
# temporarily set "version": "0.0.1", publish, then bump back to 0.1.0 for the real tag release
```

### 2. Link Trusted Publisher on npmjs.com

1. Open https://www.npmjs.com/package/pi-pacman → **Settings** → **Trusted Publisher**
2. Add GitHub Actions:
   - **Organization or user:** `smarzban`
   - **Repository:** `pi-extentions`
   - **Workflow filename:** `release.yml` (exact; not a path)
   - **Environment:** leave empty
3. Save

After this, CI can publish with **no OTP and no `NPM_TOKEN` secret**.

### 3. (Recommended) Protect `v*` tags on GitHub

Repo → **Settings** → **Tags** / rulesets: only you can create tags matching `v*`.
The release workflow also refuses tags whose commit is not on `main`, but tag protection is the primary control.

## Cut a release

1. Bump version in `packages/pi-pacman/package.json` (e.g. `0.1.1`)
2. Commit on `main` and push
3. Tag matching that version and push the tag:

```bash
git tag v0.1.1
git push origin v0.1.1
```

4. Watch **Actions → release**. On success:

```bash
pi install npm:pi-pacman
# or pin
pi install npm:pi-pacman@0.1.1
```

## What the workflow does

File: [`.github/workflows/release.yml`](../.github/workflows/release.yml)

1. Trigger on `v*` tags  
2. Assert tagged commit is on `main`  
3. Assert tag `vX.Y.Z` == `packages/pi-pacman` `version`  
4. `npm pack --dry-run`  
5. `npm publish` from `packages/pi-pacman` via OIDC  

## Install options (users)

```bash
pi install npm:pi-pacman
pi install git:github.com/smarzban/pi-extentions
pi install /path/to/pi-extentions/packages/pi-pacman
```
