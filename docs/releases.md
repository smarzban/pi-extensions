# Releases

How `@pi-extentions/pi-pacman` gets to npm (npm org: **pi-extentions**). Same pattern as
[empanel](https://github.com/smarzban/empanel): **tag → GitHub Actions → OIDC trusted publishing**.
No long-lived npm token in the repo.

## One-time setup (maintainer)

### 1. First publish (create the package under the org)

npm only lets you attach a Trusted Publisher to a package that **already exists**.

With **passkey** 2FA (no 6-digit OTP), use a granular access token that can publish to the
`pi-extentions` org and has **Bypass two-factor authentication** enabled:

```bash
npm config set //registry.npmjs.org/:_authToken=npm_YOUR_TOKEN

cd packages/pi-pacman
npm publish --access public
```

(`publishConfig.access` is already `"public"` — required for scoped packages.)

If you use an authenticator app instead:

```bash
npm publish --access public --otp=XXXXXX   # 6 digits only, not npm_…
```

### 2. Link Trusted Publisher on npmjs.com

1. Open https://www.npmjs.com/package/@pi-extentions/pi-pacman → **Settings** → **Trusted Publisher**
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
pi install npm:@pi-extentions/pi-pacman
# or pin
pi install npm:@pi-extentions/pi-pacman@0.1.1
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
pi install npm:@pi-extentions/pi-pacman
pi install git:github.com/smarzban/pi-extentions
pi install /path/to/pi-extentions/packages/pi-pacman
```
