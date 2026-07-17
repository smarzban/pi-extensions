# Looks

A **look** is a named animation for pi’s streaming working indicator.

## Summary

| Look | Width | Speed | Default message | Description |
|------|-------|-------|-----------------|-------------|
| **classic** | Full terminal (minus message) | 80 ms/frame | `waka waka...` | Pac-Man eats pellets left→right, then turns |
| **chase** | Full terminal | 80 ms/frame | `run from blinky...` | Red Blinky chases from behind → power pellet → blue scared ghost |
| **mini** | fixed cells (default 10) | 110 ms/frame | `chomp chomp...` | Short pellet run |
| **arcade** | fixed cells + wall glyphs | 110 ms/frame | `insert coin...` | Blue `│` corridor + warp flash |
| **fruit** | fixed cells | 110 ms/frame | `fruit bonus...` | Cherry bonus run (no score pop) |

Default on first run: **classic**.

## Glyphs

| Role | Characters |
|------|------------|
| Pac open | `ᗧ` (right) · `ᗤ` (left) |
| Pac closed | `○` (empty circle) |
| Pellet | `·` |
| Ghost | `ᗣ` (red Blinky / blue when scared) |
| Power | `○` (magenta) |
| Cherry | `♦` |

Colors are truecolor ANSI (yellow body, pink pellets, blue walls, etc.).

## Full-width behavior

`classic` and `chase` size the track from the terminal width:

```text
track ≈ columns − len(working message) − padding
```

They rebuild:

- on terminal **resize**
- on each **agent turn** when that look is active

Fixed looks use **`cells`** from config (default **10**, range 4–40). Set via `/pacman cells <n>` or `cells` in `~/.pi/agent/pacman-thinking.json`.

## Frame rates

| Kind | Interval |
|------|----------|
| Full-width (`classic`, `chase`) | **80** ms |
| Fixed (`mini`, `arcade`, `fruit`) | **110** ms |

## Chase storyboard (intent)

1. Pac runs **right**; Blinky trails **behind** (left of Pac).  
2. Power pellet at the far end.  
3. Pac runs **left**; scared ghost flees ahead.  

## Switch looks

```text
/pacman classic
/pacman chase
/pacman mini
/pacman arcade
/pacman fruit
/pacman rotate    # cycle mini → arcade → fruit only (not full-width)
```
