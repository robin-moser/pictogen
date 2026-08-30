<div align="center">
    <img alt="pictogen" title="pictogen" width="96" src="public/logo.svg">
    <h1 style="color: red">pictogen</h1>
    <p>
        Pictogen is a self-hosted, multi-user workspace for AI image generation.<br>
        Create images from text and references, compare models, track actual costs,<br>
        and return to named sessions from any browser.
    </p>
</div>

<img width="1600" height="915" alt="screenshot-pictogen"
    src="https://raw.githubusercontent.com/robin-moser/pictogen/refs/heads/main/public/screenshot.webp" />

## Demo

Explore the hosted demo at [pictogen.vserver.app](https://pictogen.vserver.app/?session=cb619c0a-1615-4a4a-8828-ded08411a544).
It includes prepared sessions with prompts, model settings, generation history,
and image galleries. Changes are not saved. Image generation, uploads, and
other data mutations are disabled.

## Features

- **Queueing with fair concurrency:** a global queue and per-user limits keep
  parallel, multi-model runs within the provider budget without allowing one
  user to monopolize generation capacity.
- **A live model catalog:** image-capable OpenRouter models are discovered and
  cached automatically, so the picker follows the provider catalog rather than
  relying on a manually maintained list.
- **Capability-aware requests:** Pictogen reads each model's advertised limits
  and adapts unsupported resolutions, aspect ratios, quality, background,
  output format, compression, and reference-image counts before generation.
- **Image filter presets:** compose prompts with built-in shot framing, color
  treatment, visual effect, and photographic-style presets instead of writing
  every modifier by hand.
- **Side-by-side model comparison:** submit one prompt to multiple selected
  models and review their outputs together in a single session.
- **Reference-driven iteration:** upload source images for a generation, then
  reuse any generated output as a reference for the next run.
- **Saved workspaces:** named sessions preserve drafts and generation history,
  making it possible to pause a line of work and resume it from any browser.
- **Cost visibility:** provider-reported cost is stored per image and aggregated
  into known totals for every session, including when a provider cannot report a
  complete final price.
- **Multi-user by design:** local authentication provides administrator-managed
  accounts and isolated owned data; forward-auth mode delegates identity to an
  existing trusted proxy.
- **Durable server-side history:** SQLite, originals, thumbnails, references,
  session drafts, and generation records persist on the server, surviving
  browser changes and container restarts.
- **Focused review tools:** per-model and favorite gallery filters make it
  easy to compare outputs and keep the results worth revisiting.

## Docker Compose

Create a `.env` file beside `compose.yml` with an OpenRouter API key and a
local administrator password, then start the published image:

```sh
OPENROUTER_API_KEY=replace-me
ADMIN_PASSWORD=choose-at-least-8-characters
```

```sh
docker compose up -d
```

Open `http://localhost:3000`. The named `pictogen-data` volume keeps the
database and generated images between container updates and restarts.

## Development

The project requires Node.js 24. Install dependencies, create a `.env` file from
`.env.example`, set `OPENROUTER_API_KEY` and `AUTH_MODE`, then run the API and
Vite development server together:

```sh
npm install
npm run dev
```

The frontend runs at `http://localhost:5173` and proxies API requests to the
Fastify server at `http://localhost:3000`.

## Authentication

`AUTH_MODE` is required and accepts exactly one value: `local`, `forward-auth`,
or `demo`. The modes are deployment-wide and mutually exclusive. Usernames
are trimmed and normalized to lowercase, and each username maps to one stable
user and one set of owned data. Switching modes reuses an existing normalized
username; changing the username supplied by the proxy creates a new account.

### Local mode

Local mode uses Pictogen passwords and session cookies. Proxy identity headers
are ignored.

Set `ADMIN_USERNAME` for the initial administrator. If `ADMIN_PASSWORD` is not
set when no local administrator credentials exist, Pictogen prints a temporary
password once at startup and requires it to be changed. If the normalized
username already exists, bootstrap attaches credentials to that user instead of
creating another account.

Administrators can create users, attach or reset credentials, grant or withdraw
administrator access, and remove other accounts. Removing an account deletes its
sessions, generation records, images, and thumbnails. Pictogen refuses
self-removal and removal or demotion of the last local administrator.

To recover an existing account in a built deployment, provide the password on
standard input. The command attaches credentials if needed, revokes existing
sessions, and requires a password change at the next sign-in.

```sh
read -rsp "New password: " PASSWORD; printf "\n"
printf "%s\n" "$PASSWORD" | docker exec -i pictogen node dist/scripts/set-password.js admin
unset PASSWORD
```

For Docker Compose, use `docker compose exec -T` instead of `docker exec -i`.
Running the command with empty standard input generates and prints a temporary
password.

### ForwardAuth mode

ForwardAuth accepts the username from `FORWARD_AUTH_USER_HEADER`, which defaults
to `Remote-User`. `FORWARD_AUTH_TRUSTED_PROXIES` is required and must contain the
exact direct proxy addresses or narrow CIDRs that may supply this header. Trust
is checked against the socket peer, not `X-Forwarded-For` or other forwarded
headers.

Clients must not be able to reach Pictogen around the authentication proxy. The
proxy owns sign-in policy, access control, and logout. Pictogen does not expose
local login, logout, password, or user-administration routes in this mode. Local
cookies and credentials are ignored, and stored local sessions are deleted at
startup.

`TRUST_PROXY` controls Fastify's generic forwarded-header handling separately
and defaults to `false`; it never grants permission to supply an identity
header.

### Demo mode

Demo mode exposes one shared, read-only workspace without sign-in or an
OpenRouter key. Set `AUTH_MODE=demo` and optionally `DEMO_USERNAME` (defaults to
`demo`). The user owns the sessions and generated images visitors may view.

Prepare the demo content by using the same username in local or forward-auth
mode, then deploy its data directory with demo mode enabled. Demo mode does not
register image model or generation routes, does not start a generation worker,
and rejects every API mutation.

### URLs and origins

`PUBLIC_URL` is required in production. Its protocol controls local session
cookie security. An HTTPS URL always produces `Secure` and `HttpOnly` cookies,
including behind a plain-HTTP proxy hop. Consequently, browsers correctly do not
send that cookie when the same instance is reached directly over plain HTTP.

Cross-origin mutation requests are accepted from `PUBLIC_URL` and the complete
origins in `TRUSTED_ORIGINS`. Entries include scheme and port, for example
`https://pictogen.example.com` or `https://pictogen.example.com:8443`. To allow
access through an alternate LAN hostname without listing every address, Pictogen
also accepts an origin whose host matches the request host and whose protocol
matches `PUBLIC_URL`.

## Commands

```sh
npm run format       # Format maintained files
npm run format:check # Verify formatting
npm run lint         # Run ESLint
npm run typecheck    # Check TypeScript
npm test             # Run automated tests
npm run build        # Build the production client and server
npm run user:set-password -- admin # Reset an existing user's password from stdin
```

---

Inspired by [imagen-openrouter](https://github.com/yusufipk/imagen-openrouter/).

_This project was developed with AI assist tools._
