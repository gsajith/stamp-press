# Stamps are an art source plus a seed, and published styles stay frozen

A stamp is identified by its art source and its seed, and a share link carries exactly that pair (`?stamp=<source>-<seed>`). We chose this over uploading art to a backend or putting the image in the URL. It keeps the site static, costs nothing per stamp, and gives every stamp from a shared source (procedural styles, the default library) a short link.

Two consequences follow:

- A stamp from a visitor's local library can't be rebuilt on another device, so its link says the stamp exists only on that device. Uploading art comes later, with album sharing.
- A seed must keep producing the same stamp. Once a style ships, its output for a given seed doesn't change. A change to a published style ships as a new style version with its own source id, and the old version stays so existing links keep working.
