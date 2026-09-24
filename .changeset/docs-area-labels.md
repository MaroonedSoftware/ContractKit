---
'@contractkit/plugin-docs': minor
---

Add an `areaLabels` option that names area groups: `"areaLabels": { "openai": "OpenAI" }`. It applies to the Docusaurus category labels, the Mintlify `docs.json` groups and the Markdown reference's area headings, which otherwise humanize the area (`openai` became "Openai"). Set it at the plugin level for every target, or on `markdown`, `mintlify` or `docusaurus`, whose map is merged over the plugin-level one.
