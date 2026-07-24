# Operations Checklist

## One Product Run

1. Pick one product and one affiliate URL.
2. Add owned clips, official assets, AI-generated assets, and reference-only URLs to the source board.
3. Keep reference-only material as `usage: reference`.
4. Save `project.yaml` from the app.
5. Run Validate.
6. Render only after FFmpeg is installed and every clip path is real.
7. Run Package.
8. Review `manifest.json`, platform caption files, fixed comments, `source_risk_report.json`, and `source_traceability.json`.
9. Upload manually to YouTube Shorts, Instagram Reels, and TikTok.
10. Record real performance only after the content has had enough time to collect results.

## Quality Gate

Block upload when:

- Affiliate or ad disclosure is missing.
- Source rights are unclear for any edit source.
- Package output is incomplete.

Review before upload when:

- Hook is too long or unclear.
- Captions are hard to read on mobile.
- Duration or ratio does not fit the selected platform.

## Multi Product Workflow

Use one folder per product:

```text
projects/<product-slug>/
  project.yaml
  clips/
  bgm/
  output/
```

Recommended naming:

```text
<category>-<product>-<campaign-number>
```

## Longform Highlight Analysis

After FFmpeg is installed, analyze a long video and create candidate shorts metadata:

```bash
npm run dev -- analyze-longform ./path/to/longform.mp4 --product-name "Product Name" --affiliate-url "https://example.com/product"
```

When an SRT transcript exists, pass it to promote segments that mention the product, price, discount, review, result, recommendation, or link:

```bash
npm run dev -- analyze-longform ./path/to/longform.mp4 --transcript ./path/to/longform.srt --product-name "Product Name" --affiliate-url "https://example.com/product"
```

For a visual signal pass, add FFmpeg scene-change scoring:

```bash
npm run dev -- analyze-longform ./path/to/longform.mp4 --vision-scoring --transcript ./path/to/longform.srt --product-name "Product Name" --affiliate-url "https://example.com/product"
```

Outputs are written next to the source video by default:

```text
longform-analysis/longform_analysis.json
longform-analysis/first_shorts_project.yaml
```

The current analysis uses ffprobe metadata, FFmpeg silence detection, optional SRT keyword overlap, and optional FFmpeg scene-change scoring to create ranked cut candidates. Human review is still required before upload because this does not yet judge faces, claims, or copyright context.

## Story Image To Video

Generate images from a story script with the OpenAI Responses API:

```bash
set OPENAI_API_KEY=your_key_here
npm run dev -- generate-story-images ./path/to/story-image-input.json --out-dir ./projects/story-generated
```

For offline testing, use the deterministic mock provider:

```bash
npm run dev -- generate-story-images ./path/to/story-image-input.json --provider mock --out-dir ./projects/story-generated
```

Then turn the generated storyboard or a manually prepared storyboard into video clips:

```bash
npm run dev -- storyboard-render ./projects/story-generated/storyboard.json --out-dir ./projects/story-video
```

The command creates:

```text
projects/story-video/clips/scene_01.mp4
projects/story-video/project.yaml
projects/story-video/story_video_report.json
```

Use this after AI image generation or manual image collection. The current pipeline can call OpenAI when `OPENAI_API_KEY` is set, can run fully offline with `--provider mock`, turns generated or owned images into captioned MP4 scenes, and traces them as `ai_generated` by default.

## Product Source Discovery

Discover product-related YouTube reference videos:

```bash
set YOUTUBE_API_KEY=your_key_here
npm run dev -- discover-sources --product-name "Product Name" --out-dir ./projects/source-discovery
```

Offline verification:

```bash
npm run dev -- discover-sources --product-name "Product Name" --provider mock --out-dir ./projects/source-discovery
```

Outputs:

```text
source_discovery.json
source_board.json
source_traceability.json
```

Discovery results are reference-only by default. Use them for hook structure, claims to verify, visual planning, and source tracking. Do not cut them directly into an edit unless the rights state is separately changed to owned, licensed, official brand, Creative Commons, or another cleared edit source.

## Direct Upload Automation

Always package first:

```bash
npm run dev -- package ./projects/<product-slug>
```

Then run one of the safe verification modes:

```bash
npm run dev -- upload-package ./projects/<product-slug>/output/publish_package --mode dry_run
npm run dev -- upload-package ./projects/<product-slug>/output/publish_package --mode mock
```

`dry_run` creates `upload_results.json` with the planned platform requests. `mock` verifies that every platform item can move through the upload provider contract without external API calls.

Use live mode only after the package, captions, source risk report, affiliate disclosure, and platform metadata have been reviewed:

```bash
set YOUTUBE_ACCESS_TOKEN=your_oauth_token
set INSTAGRAM_ACCESS_TOKEN=your_graph_api_token
set INSTAGRAM_USER_ID=your_ig_user_id
set TIKTOK_ACCESS_TOKEN=your_tiktok_token
npm run dev -- upload-package ./projects/<product-slug>/output/publish_package --mode live --public-base-url https://cdn.example.com/package-videos
```

Live provider defaults are conservative: YouTube privacy defaults to private, TikTok privacy defaults to `SELF_ONLY`, and Instagram requires a public video URL. Treat a live upload result as a draft check before opening visibility.

## Speed Measurement

Track the time from product selection to package creation:

```text
product selected -> clips prepared -> validate passed -> render done -> package done
```

Do not optimize speed until the first complete manual run is stable.

## Performance Lab Entry

The app includes a Performance Lab CSV input. Treat summaries as directional only after at least 5 real posted records with:

- posted URL
- views
- clicks
- orders
- revenue
- cost

Use the in-app template when starting a new run. The summary calculates views, clicks, orders, revenue, cost, profit, CTR, and conversion rate, while still warning when fewer than 5 records exist.

## Release Gate

Before a release candidate:

```bash
npm run verify
```

The release gate now also creates:

```text
release/shorts-factory-local-app/
release/shorts-factory-local-app.zip
```

For a release-only rebuild after `npm run build`:

```bash
npm run release:bundle
```

The bundle includes a release-specific `package.json`, `START_HERE.md`, the compiled CLI, local app UI, server launcher, docs, and the sample project without generated output.

Also verify in the browser:

- Desktop has no horizontal overflow.
- Mobile starts with the new project form.
- Save Local and Validate work from `npm run app`.
- Source board changes update YAML and risk output.
- Manifest, risk report, and traceability files are present in package output.

FFmpeg render smoke is required after FFmpeg is installed.
