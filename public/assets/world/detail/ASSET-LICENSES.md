# World detail assets

## Rock surface

Source: [Aerial Rocks 01](https://polyhaven.com/a/aerial_rocks_01), Rob Tuytel / Poly Haven.
License: [CC0](https://polyhaven.com/license). Downloaded 2026-09-14 using the public asset file manifest.

| Local file | Original 1K JPEG |
| --- | --- |
| rock-albedo.webp | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/aerial_rocks_01/aerial_rocks_01_diff_1k.jpg |
| rock-normal.webp | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/aerial_rocks_01/aerial_rocks_01_nor_gl_1k.jpg |
| rock-roughness.webp | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/aerial_rocks_01/aerial_rocks_01_rough_1k.jpg |

Encoded locally as 1024 × 1024 WebP. The OpenGL normal and roughness maps use linear color space. Original normal JPEG MD5: `4382a74e50d0df411135fc87c8da449a`, checked against the source manifest after resumable download. The rock material is also tinted and repeated on architectural pieces and tree bark; it is not a separate scanned bark asset.

## Pine branch

`pine-branch-v2.webp`: generated for this project with the built-in `image_gen.imagegen` tool, 2026-09-14. Original transparent PNG and full prompt are recorded in `docs/world-art-prompts.md`. The web asset is resized and encoded only; the 3D tree arrangement is procedural geometry in `src/world/landscapeGeometry.ts`.

All runtime assets are served locally. No external model or texture service is requested by the game.
