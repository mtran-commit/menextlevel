# App icon & splash source images

These three files are required before the first Codemagic build.
`@capacitor/assets generate` reads them and produces all iOS sizes automatically.

| File             | Size          | Notes                                      |
|------------------|---------------|--------------------------------------------|
| icon-only.png    | 1024 × 1024 px | The Me Next Level mark, no padding, no background |
| splash.png       | 2732 × 2732 px | Light-mode launch screen                   |
| splash-dark.png  | 2732 × 2732 px | Dark-mode launch screen                    |

Place the PNG files here and commit them before triggering a Codemagic build.
