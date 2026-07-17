# Looks

A **look** is a named animation for pi’s streaming working indicator.

## Summary

| Look | Width | Speed | Default message | Description |
|------|-------|-------|-----------------|-------------|
| **classic** | Full terminal (minus message) | 80 ms/frame | `waka waka...` | Pac-Man eats pellets left→right, then turns |
| **chase** | Full terminal | 80 ms/frame | `run from blinky...` | Red Blinky chases from behind → power pellet → blue scared ghost |
| **mini** | 7 cells | 110 ms/frame | `chomp chomp...` | Short pellet run |
| **arcade** | 7 cells + wall glyphs | 110 ms/frame | `insert coin...` | Blue `│` corridor + warp flash |
| **fruit** | 7 cells | 110 ms/frame | `fruit bonus...` | Cherry bonus + `100` / `300` pops |

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

Fixed looks always use **7** cells (`FIXED_CELLS`).

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
/pacman rotate    # cycle all of the above each message
```
