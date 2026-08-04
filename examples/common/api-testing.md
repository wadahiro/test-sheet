# API testing notes

## Authentication

Every request needs an API key in the `X-API-Key` header. Issue a short-lived key with:

```bash
curl -X POST https://api-staging.example.com/keys -d '{"ttl": "1h"}'
```

## Reading rate limit headers

Responses carry the current limit state. Check these rather than inferring from timing:

| Header | Meaning |
|--------|---------|
| `X-RateLimit-Limit` | Requests allowed per window |
| `X-RateLimit-Remaining` | Requests left in the current window |
| `X-RateLimit-Reset` | Unix time when the window resets |
