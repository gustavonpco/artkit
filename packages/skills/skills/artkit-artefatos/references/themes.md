# Theme tokens

Colors are written as tokens so artifacts follow the theme (light, dark, brand). Use a hex value ("#RRGGBB") only when the user asks for a specific color.

| Token | Mouts (`default`) |
|---|---|
| `text` | #1D2F3C |
| `muted` | #56636D |
| `accent` | #0F7A5A |
| `background` | #FFFFFF |
| `surface` | #F4F7F7 |
| `info` | #1D2F3C |
| `warning` | #73692F |
| `success` | #0F7A5A |
| `danger` | #9F343A |

## Typography

| Theme | Heading | Body | Mono |
|---|---|---|---|
| `default` | Sora | Sora | Consolas |

## Chart palette

- `default`: #179A7C, #1D2F3C, #0F7A5A, #73692F, #56636D

Change the theme of an artifact with the `set_theme` envelope operation and a theme id from this table.
