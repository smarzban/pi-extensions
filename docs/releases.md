# Releases

Packages version and publish independently. A tag has the form `pi-<name>-vX.Y.Z`, for example `pi-spawn-v0.1.1`.

## Normal release

1. Update `packages/pi-<name>/package.json` on `main`.
2. Verify the package:

   ```sh
   cd packages/pi-<name> && npm pack --dry-run
   ```

3. Create and push the matching tag:

   ```sh
   git tag pi-<name>-vX.Y.Z
   git push origin pi-<name>-vX.Y.Z
   ```

The `release.yml` GitHub Actions workflow checks that the tag is reachable from `main`, checks the tag version against `package.json`, runs `npm pack --dry-run`, then publishes with npm OIDC trusted publishing.

## First publish

npm Trusted Publisher can only be attached after a package exists. Publish the initial version manually with an authenticated npm account, then add this repository as that package's Trusted Publisher in npm settings:

- Organization or user: `smarzban`
- Repository: `pi-extensions`
- Workflow: `release.yml`
- Environment: leave empty

Do not commit npm tokens. Do not push an initial-version release tag after a manual publish, because the workflow would try to publish the same version again.
