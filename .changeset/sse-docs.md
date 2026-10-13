---
'@contractkit/plugin-docs': minor
---

Document Server-Sent Events responses. The OpenAPI target emits a `text/event-stream` body's type as `content['text/event-stream'].schema` with `x-contractkit-stream: true` on the media type, marking the schema as that of each event, and the Mintlify target picks this up from the document. The Markdown and Docusaurus targets label the response as a stream of the event type.
