# Stamp press

A 3D toy where each press of a button generates a new postage stamp that falls onto a desk. Visitors can open any stamp to look at it up close, and later keep stamps in an album.

## Language

### Stamps

**Stamp**:
One generated postage stamp: a piece of art on paper, cut out with a punched edge.
_Avoid_: Card, tile, item

**Art**:
The picture on a stamp, the part that varies the most from stamp to stamp.
_Avoid_: Image, design, artwork

**Punch**:
The cut that turns paper into a stamp, giving it its outline and toothed edge, like a craft stamp punch.
_Avoid_: Border, frame, mount, perforation

**Margin**:
The plain paper between a stamp's art and its punched edge. A full-bleed stamp has none.
_Avoid_: Border, gutter

**Art source**:
Where a stamp's art comes from, such as a procedural style, a library of art, or an image model. A stamp's reference names its art source and its seed, like `land1-1z141z3`.
_Avoid_: Provider, generator, backend

**Style**:
One procedural look, such as a landscape silhouette or a guilloche rosette, drawn by code from a seed. Each style is its own art source, addressed directly in a stamp's reference by its versioned id, such as `land1`.
_Avoid_: Generator, theme, template

**Seed**:
The value that, with its art source, fully determines a stamp, so the same pair always yields the same stamp.
_Avoid_: ID, key

**Share link**:
The page's address with a stamp's reference in `?stamp=`, such as `?stamp=land1-1z141z3`. The address carries it while that stamp is in the detail view. Opening one drops that stamp first on an empty desk, then opens it once it lands.
_Avoid_: Permalink, URL

**Palette**:
A shared set of two to four inks and a paper tone that a stamp is printed in, picked by its seed.
_Avoid_: Theme, color scheme

**Drop**:
One stamp falling from above and landing art up on the desk. A lone drop lands a step away from the previous stamp, and the camera follows it. A drop in a burst lands somewhere on the desk already on screen.
_Avoid_: Spawn, pull, roll

**Burst**:
Presses that come while an earlier drop is still falling, or within about a second of the last press. The camera holds still for a burst, and its drops spread across the screen.
_Avoid_: Spam, combo

### Places

**Desk**:
The paper surface stamps fall onto and scatter across.
_Avoid_: Floor, table, canvas

**Detail view**:
One stamp lifted from the desk and brought close, where the visitor can tilt, pan and zoom it.
_Avoid_: Modal, stamp page, zoom view

**Album**:
The stamps a visitor has chosen to keep, laid out like a stamp collector's album.
_Avoid_: Collection, gallery
