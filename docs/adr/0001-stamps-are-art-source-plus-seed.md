# Stamps are an art source plus a seed, and published styles stay frozen

A stamp is identified by its art source and its seed, and a share link carries exactly that pair (`?stamp=<source>-<seed>`). We chose this over uploading art to a backend or putting the image in the URL. It keeps the site static, costs nothing per stamp, and gives every stamp from a shared source (procedural styles, the default library) a short link.

Each procedural style is its own art source, addressed by its versioned style id, and the seed is written in base36 to keep links short: `land1-1z141z3`. A press picks a style at random from the current list, then a seed drives the stamp within that style. An earlier design had one `procedural1` source whose seed picked the style, so adding a style changed what existing seeds resolved to. Naming the style in the reference means adding one never changes an existing link.

Three consequences follow:

- A stamp from a visitor's local library can't be rebuilt on another device, so its link says the stamp exists only on that device. Uploading art comes later, with album sharing.
- A seed must keep producing the same stamp. Once a style ships, its output for a given seed doesn't change. A change to a published style ships as a new style version with its own id, and the old version stays registered, though no longer pressed, so existing links keep working.
- What every style shares (how the seed picks a palette, punch and margin, and the palette list it picks from) is frozen too, since changing it would change every published style's stamps.
