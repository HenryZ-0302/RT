# RT Cloudflare Account Router

This is a standalone Cloudflare Worker that keeps only the multi-account round-robin logic.

It does **not** do provider/model translation. It simply:

- stores multiple upstream accounts
- picks one enabled account in round-robin order
- forwards the original `/v1/*` request to that account
- retries another account when the selected one returns a network error or 5xx

## Required secrets

Set these in Cloudflare:

- `AUTH_TOKEN`: bearer token required for both admin and proxy calls

Optional:

- `ACCOUNT_COOLDOWN_MS`: how long a failed account is skipped after a 5xx/network error. Default `30000`

## Admin endpoints

All admin endpoints require:

`Authorization: Bearer <AUTH_TOKEN>`

### List accounts

`GET /admin/accounts`

### Add or replace account

`POST /admin/accounts`

```json
{
  "id": "acc-1",
  "label": "Account 1",
  "baseUrl": "https://api.openai.com",
  "apiKey": "sk-xxx",
  "enabled": true,
  "extraHeaders": {
    "OpenAI-Organization": "org_xxx"
  }
}
```

### Update account

`PATCH /admin/accounts/:id`

Body supports any subset of:

```json
{
  "label": "New label",
  "baseUrl": "https://api.openai.com",
  "apiKey": "sk-xxx",
  "enabled": false,
  "extraHeaders": {
    "OpenAI-Organization": "org_xxx"
  }
}
```

### Delete account

`DELETE /admin/accounts/:id`

## Proxy usage

Send the same bearer token:

`Authorization: Bearer <AUTH_TOKEN>`

Then call the worker like a normal OpenAI-compatible endpoint:

- `GET /v1/models`
- `POST /v1/chat/completions`
- any other `/v1/*` route

The worker forwards the original path and query string to the chosen account `baseUrl`.

## Deploy

```bash
pnpm --filter @rt/cf-account-router install
pnpm --filter @rt/cf-account-router deploy
```
