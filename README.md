# Pictogen

Pictogen is a self-hosted, multi-user workspace for AI image generation.
Create images from text and references, compare models, track actual costs,
and return to named sessions from any browser.

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

`AUTH_MODE` is required and accepts exactly one value: `local` or
`forward-auth`. The modes are deployment-wide and mutually exclusive. Usernames
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
