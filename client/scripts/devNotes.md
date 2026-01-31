# Dev Notes – API Configuration

## Environment Variables

Set the following env vars before running the Next.js app:

```bash
NEXT_PUBLIC_API_BASE=https://findclinicaltrial.org
# Optional bearer token for protected endpoints
NEXT_PUBLIC_API_TOKEN=your_api_token_here
```

- Leave `NEXT_PUBLIC_API_BASE` empty to activate the local mock API responders in `src/mocks`.
- For local development you can use `.env.local`:

```bash
NEXT_PUBLIC_API_BASE=http://localhost:5002
NEXT_PUBLIC_API_TOKEN=
```

## TanStack Query

Phase 3 introduces TanStack Query for caching and retries. No extra configuration is required—`QueryProvider` is wired in `app/layout.tsx`.
