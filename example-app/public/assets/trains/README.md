# Train test images

These six 960 × 540 JPEGs are original geometric train illustrations created for
this demo. They contain no third-party photos, logos, fonts, or other artwork.

To the extent possible under law, the contributors waive all copyright and
related rights in these illustrations under **CC0 1.0 Universal**:
https://creativecommons.org/publicdomain/zero/1.0/

No attribution is required. The images depict fictional trains, not actual
operator liveries; NMBS, DB, and OBB are just the demo's route identifiers.

## Checking page preparation

1. Open DevTools → Network, disable the browser cache, and filter by `jpg`.
2. Reload Home, then hover or keyboard-focus Account or Agencies without clicking.
3. Look for `/assets/trains/account.jpg` or `/assets/trains/agencies.jpg` requests
   before navigation. The images are normal eager `<img>` elements, not globally
   preloaded resources, so this tests whether page preparation loads its assets.
4. On the agency list, compare NMBS (default prefetch), DB (150 ms hover delay),
   and ÖBB (prefetch disabled). Each has a different image URL; ÖBB should only
   request `OBB.jpg` on navigation.

Home uses `home.jpg`. Unknown agency identifiers fall back to `agencies.jpg`.
The filename is also shown beneath each image. Reload between repeat tests to
avoid confusing retained/prepared pages or cached images with new requests.
