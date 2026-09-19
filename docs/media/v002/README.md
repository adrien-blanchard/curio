# Product screenshots and tour

## Final portfolio exports

The repository includes the owner's final exports: `curio_01.jpg` through `curio_05.jpg`,
`Curio Full.mp4` (38.38 seconds, Full HD, with audio), and `Curio Preview.mp4` (7.67 seconds, 720p,
silent). MOV masters, RAW files, earlier renders and standalone soundtrack files remain local and
are excluded from Git. Keep the [music credit](MUSIC-CREDIT.md) alongside the full video.

[Watch the final tour](Curio%20Full.mp4) · [Short preview](Curio%20Preview.mp4)

## Recording sources (local only)

The media is an English product walkthrough of the actual Curio components and extension UI, using
synthetic local fixtures. It does not demonstrate a real account, remote database mutation, or a
live Gemini call. The extension submission response is simulated for recording. No personal email,
API key or private catalog is included.

All deliverables are grouped here in `docs/media/v002/`. The original delivery is preserved in
`docs/media/v001/`. Intermediate recording files remain in the ignored `artifacts/product-tour/`.

- `01-dashboard.jpg`: cards, filters and source-age badges.
- `02-entry-detail.jpg`: summary, source date, tags and attribution.
- `03-entry-editor.jpg`: management panel including date correction.
- `04-tags-and-topics.jpg`: taxonomy management.
- `05-members.jpg`: members and role controls.
- `06-chrome-extension.jpg`: the real popup UI presented over a dashboard backdrop.
- `curio-tour.en.mp4`: 1080p H.264 video with English captions, no audio.
- `curio-tour-clean.mp4`: the same recording without captions.
- `curio-tour.en.srt`: editable English captions.

The screenshots have no promotional text added. Text in the application itself remains visible.
High-quality JPGs (95%, 4:4:4 chroma), optimized WebP copies and an English video are prepared in
`docs/media/v002/` for GitHub. The PNG originals remain in the artifact folder. The revised video is
38.4 seconds, with an explicit Chrome extension sequence. All demo source dates are fictional,
covering the three age categories; no dates on real entries were changed for this recording.

The videos are `curio-tour.en.mp4` and `curio-tour-clean.mp4`, with editable `curio-tour.en.srt`.
Both videos are silent. The optional soundtrack is separate: `curio-music-38s.wav` and
`curio-music-38s.mp3`; see [music attribution](MUSIC-CREDIT.md).

## Gallery

![Curio dashboard](curio_01.jpg) ![Curio interface](curio_02.jpg) ![Curio interface](curio_03.jpg)
![Curio interface](curio_04.jpg) ![Curio interface](curio_05.jpg)

[Watch the English tour](Curio%20Full.mp4)

## Reproduce

Start the local Next development server with `CURIO_CAPTURE_MODE=true`, then run
`npm run media:capture`, then `node scripts/edit-product-tour.mjs`, then `npm run media:prepare`.
The editing script expects `Cipher-original.mp3` in the artifact directory, downloaded from the
composer's catalog (`Cipher2.mp3`, see the music credit). The `/demo/studio` fixture harness is
inaccessible in a production build and when the capture flag is absent. It renders the actual
dashboard, card, modal, tag-management and member-table components, using only fictional entries and
identities. The script records real browser clicks and guards API calls with synthetic responses. It
requires Playwright Chromium and FFmpeg on PATH. It does not install or publish the extension.

Before replacing published media, inspect all images and representative video frames. Update
synthetic dates if recapturing later so the age examples remain representative. The capture scripts
never overwrite the owner's final `curio_*.jpg` and `Curio *.mp4` exports; final editing and audio
assembly are manual.

For a portfolio, use an image as the video poster, `controls`, `preload="metadata"`, and a
user-initiated play action. Avoid loading the full video on initial page load. On GitHub, link the
MP4 from a preview image or upload it to a GitHub Release and use the resulting asset URL.
