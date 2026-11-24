# Appearance type library

These unchanged Latin WOFF2 distributions are self-hosted. The app makes no Google Fonts requests. Rendering selects only the used faces; app installation separately precaches the complete library for offline use. Missing files or characters use the registry fallback stack. All faces are upright variable fonts, with authoring restricted to genuine weights 400, 500, 600 and 700. A role set to italic uses browser slant synthesis; no italic font file is claimed or bundled.

Retrieved 2026-11-23 from the official Google Fonts CSS API and versioned Google Fonts CDN. The accompanying original SIL Open Font License 1.1 notices permit bundled redistribution. No font is sold separately or endorsed by the authors. No local font modification was made.

| File | Credit | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| cinzel-latin-variable.woff2 | Cinzel Project Authors; designer Natanael Gama | 25,904 | 09941fb1c169c38fd414536b37690057fc01b3117a5c63dd6571186540c8f370 |
| roboto-condensed-latin-variable.woff2 | Roboto Project Authors; designer Christian Robertson | 51,412 | 8d230115e58faa2ed303bee567b91d1a792e0c958a0118998b53648b2ab7c057 |
| literata-latin-variable.woff2 | Literata Project Authors; designer TypeTogether | 85,672 | 7478e1920209e51dcc235d151d2056a0a6e3c54b4436f7030d256f231fe09b58 |

Total font payload: **162,988 bytes** (about 159 KiB). Latin coverage includes the ranges declared in appearance-fonts.css; other scripts and game symbols intentionally retain system fallbacks.

The service worker deliberately precaches all three binaries during app installation so every family is available offline immediately. Outside installation, CSS loads only a selected face; it has no runtime external source.

Fallback normalization uses numeric x-height ratios from each official source TTF's OS/2 sxHeight divided by head unitsPerEm: Cinzel 500/1000, Roboto Condensed 1082/2048, Literata 507/1000. These are specified by the [OpenType OS/2](https://learn.microsoft.com/en-us/typography/opentype/spec/os2#sxheight) and [head](https://learn.microsoft.com/en-us/typography/opentype/spec/head) tables. Numeric values keep fallback sizing explicit without automatic primary-font metric discovery; missing CSS support safely leaves the ordinary fallback stack.

Official source, metadata and license:

- [Cinzel metadata](https://github.com/google/fonts/blob/main/ofl/cinzel/METADATA.pb), [license](https://github.com/google/fonts/blob/main/ofl/cinzel/OFL.txt), [upstream](https://github.com/NDISCOVER/Cinzel), [bundled WOFF2 source](https://fonts.gstatic.com/s/cinzel/v26/8vIJ7ww63mVu7gt79mT7.woff2). The original Cinzel FONTLOG is also included.
- [Roboto Condensed metadata](https://github.com/google/fonts/blob/main/ofl/robotocondensed/METADATA.pb), [license](https://github.com/google/fonts/blob/main/ofl/robotocondensed/OFL.txt), [upstream](https://github.com/googlefonts/roboto-classic), [bundled WOFF2 source](https://fonts.gstatic.com/s/robotocondensed/v31/ieVl2ZhZI2eCN5jzbjEETS9weq8-19K7DQ.woff2).
- [Literata metadata](https://github.com/google/fonts/blob/main/ofl/literata/METADATA.pb), [license](https://github.com/google/fonts/blob/main/ofl/literata/OFL.txt), [upstream](https://github.com/googlefonts/literata), [bundled WOFF2 source](https://fonts.gstatic.com/s/literata/v40/or3PQ6P12-iJxAIgLa78DkTtAoDhk0oVpaK3YLanFLHpPf2TbLi4J_HWTA.woff2).

The original notices are preserved as cinzel-OFL.txt, roboto-condensed-OFL.txt, and literata-OFL.txt. To replace a face, verify its current upstream license, review native and fallback metrics in both control layouts, update hashes, and rerun the font and surface browser regressions. Do not replace bundled files with runtime CDN imports.
