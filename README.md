# Draftflow

Draftflow is a collaborative AI editor. You type text, the AI acts like another participant in a Google Doc and goes and corrects your writing for you.

See [this post]((https://vishnugopal.com/2025/02/04/draftflow-a-collaborative-crdt-aware-editor-ai/)) for more info.

## Getting Started

First, make sure you have an `OPENAI_API_KEY=` line with [the API key](https://platform.openai.com/settings/organization/api-keys) in `.env.local`.

Then run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to load the editor.
