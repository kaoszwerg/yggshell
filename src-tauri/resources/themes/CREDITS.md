# Bundled colour schemes

Every scheme in this directory is a `.yggtheme` file — a **real iTerm2 plist**, byte-for-byte in the
format iTerm2 itself writes. The extension marks where the file came from; it changes nothing about
what is inside, which is why iTerm2 (and anything else that reads `.itermcolors`) can open them.

## Ours

`Yggdrasil`, `Bifrost` and `Fimbulwinter` were made for this app. Yggdrasil is the HUD's own palette.

## Ported from elsewhere, with thanks

Each of these was checked against its own upstream licence before being included — not against the
licence of the collection they were downloaded from. All are MIT, which permits redistribution
provided the copyright notice travels with them; that is what this file is.

| Scheme | Upstream | Licence |
| --- | --- | --- |
| Solarized Dark, Solarized Light | Ethan Schoonover, `altercation/solarized` | MIT, © 2011 Ethan Schoonover |
| Dracula | `dracula/dracula-theme` | MIT, © 2023 Dracula Theme |
| Nord | Sven Greb, `nordtheme/nord` | MIT, © 2016-present Sven Greb |
| Catppuccin Mocha, Catppuccin Latte | `catppuccin/catppuccin` | MIT, © 2021 Catppuccin |
| Tomorrow, Tomorrow Night | Chris Kempson, `chriskempson/tomorrow-theme` | MIT, © 2011 Chris Kempson |
| Ayu Dark, Ayu Mirage, Ayu Light | `ayu-theme/ayu-colors` | MIT |

The `.itermcolors` ports themselves were taken from
[`mbadolato/iTerm2-Color-Schemes`](https://github.com/mbadolato/iTerm2-Color-Schemes) — MIT,
© 2011 to present Mark Badolato — and converted here by this app's own reader and writer.

**Deliberately absent:** Gruvbox. Its repository carries no licence file at all, and "widely used"
is not a licence. It can still be imported by anyone who has it.
