# Pictogen

Pictogen is a self-hosted, multi-user workspace for AI image generation.
Create images from text and references, compare models, track actual costs,
and return to named sessions from any browser.

## Development

The project requires Node.js 24. Install dependencies, create a `.env` file from
`.env.example`, set `OPENROUTER_API_KEY`, then run the API and Vite development
server together:

```sh
npm install
npm run dev
```

The frontend runs at `http://localhost:5173` and proxies API requests to the
Fastify server at `http://localhost:3000`.

## Commands

```sh
npm run format       # Format maintained files
npm run format:check # Verify formatting
npm run lint         # Run ESLint
npm run typecheck    # Check TypeScript
npm test             # Run automated tests
npm run build        # Build the production client and server
```
