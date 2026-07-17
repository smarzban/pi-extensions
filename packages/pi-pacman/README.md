# pi-pacman

Pac-Man working indicator for [pi](https://github.com/earendil-works/pi).

Replaces the streaming spinner with pellet runs, ghost chases, arcade tunnels, and fruit bonuses.

## Install

```bash
# from npm (after publish)
pi install npm:pi-pacman

# local path (this monorepo)
pi install /absolute/path/to/pi-extentions/packages/pi-pacman
```

### Publish to npm

```bash
cd packages/pi-pacman
npm login          # once
npm publish --access public
```

Then anyone can:

```bash
pi install npm:pi-pacman
# or pin a version
pi install npm:pi-pacman@0.1.0
```

## Commands

| Command | Effect |
|---------|--------|
| `/pacman` | Show current look |
| `/pacman list` | Catalog of looks |
| `/pacman <look>` | Lock to that look (stops rotate) |
| `/pacman rotate` | Cycle a different look every message |
| `/pacman off` | Hide the indicator (stops rotate) |
| `/pacman message <text>` | Custom working message |
| `/pacman message` | Reset message to look default |
| `/pacman clear` | Hide the look list widget |

### Looks

| Look | Vibe |
|------|------|
| `classic` | Full-width pellet run (default) |
| `chase` | Full-width Blinky hunt → revenge |
| `mini` | 7-cell pellet run |
| `arcade` | 7-cell maze tunnel |
| `fruit` | 7-cell cherry bonus |

Speeds: full-width **80ms**/frame · fixed **110ms**/frame.

## Persistence

Look, rotate on/off, rotate index, and custom message save to `~/.pi/agent/pacman-thinking.json`.

## One-shot (without install)

```bash
pi --extension ./index.ts
```
