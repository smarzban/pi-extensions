# Development

Packages are independent Pi extensions. They are TypeScript or JavaScript source loaded by Pi, with no monorepo build step.

## Verify a package

The CI workflow runs this for every package:

```sh
cd packages/pi-pacman && npm pack --dry-run
```

Run the equivalent command in the package you changed. Packages with an `npm test` script may also have their own test suite, for example:

```sh
cd packages/pi-spawn && npm test
```

## Try a local package

Install one package by absolute path, then restart Pi or start a new session:

```sh
pi install /absolute/path/to/pi-extensions/packages/pi-pacman
```

Use the package README for its commands, configuration, and expected behavior.
