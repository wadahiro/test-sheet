# Test prerequisites

## Environment

Run every test case below against the staging environment unless the case says otherwise.

| Item | Value |
|------|-------|
| Base URL | `https://staging.example.com` |
| API base URL | `https://api-staging.example.com` |
| Browser | Latest Chrome, default window size |

Reset the environment before a test run:

```bash
./scripts/reset-staging.sh --seed accounts
```

## Test accounts

| Account | ID | Purpose |
|---------|-----|---------|
| Standard | `user@example.com` | The default account for happy-path cases |
| Locked | `locked@example.com` | Already locked; used by lockout cases |
| Admin | `admin@example.com` | Only where a case explicitly calls for it |

Passwords for all seeded accounts are in the team password manager under
*staging / test accounts*. Never reuse these outside staging.

## Recording results

- Record a result for every step, not only the final one.
- On failure, attach a screenshot and the request ID from the response headers.
- A case only passes when every one of its expected results is met.
