# TensorX provider

`extensions/my-stuff/tensorx-provider.ts` registers the `tensorx` provider and its model
catalog, and spreads requests across several API keys.

TensorX meters each key independently, so a 429 on one key is survivable by reissuing the
same request on another. That is the whole reason the pool exists.

## Keys

`~/.pi/agent/tensorx-keys.json`, mode 0600, outside this repo:

```json
{
  "keys": [
    { "key": "sk-...", "label": "one" },
    { "key": "sk-...", "label": "two", "enabled": false }
  ]
}
```

A bare string works in place of an object; the label then defaults to `key-<n>`. `enabled:
false` keeps an entry on file without ever leasing it. Duplicate keys are dropped, because
two entries holding one key would look like two lanes while sharing one quota.

When the file is absent it is created from the `tensorx` entry in `auth.json`, so a fresh
machine keeps working before any keys are added. The extension honors
`PI_CODING_AGENT_DIR`.

## When rotation engages

Below two keys the provider registers exactly as a plain provider does and pi resolves the
single credential itself. At two or more, requests route through a wrapper that leases one
key each, picking fewest-in-flight and then least-recently-used, so concurrent subagents
land on different keys.

A failed request rotates only when the key is at fault:

- **429** cools the key for `cooldownMs`, or for the server's `retry-after` when it sends
  one, and retries on the next key.
- **401/403** cools the key for `invalidCooldownMs` and retries on the next key.
- **Anything else** is relayed to pi untouched. A 500 or a dropped socket is not a key
  problem, and rotating on it would burn the pool on a fault no other key can fix.

Events reach the session only once an attempt is healthy, so a rotated attempt never leaves
a half-written message for the retry to duplicate.

When every key is cooling, the request waits for the earliest one to recover rather than
failing immediately. `rotationBudgetMs` caps that total wait; past it the request fails with
a message naming the attempt count and the last provider error.

The 429 status is read through a fetch wrapped around the request. pi-ai invokes
`onResponse` only after the SDK call resolves, so on a 429 the SDK throws first and the
status never surfaces there.

## Where the leased key has to go

A lease sets both `apiKey` and the `Authorization` header on the attempt, and setting only
the first sends the wrong key.

The registration declares `authHeader: true`, so before the wrapper is ever called pi
resolves its own credential (CLI, then `auth.json`, then env) and puts `Authorization:
Bearer <that key>` in the request headers. pi-ai merges caller headers over its client
defaults, and openai-node ranks `defaultHeaders` above the key the client was constructed
with. An inherited header therefore outranks the lease and pins every attempt to one key,
which looks exactly like rotation working: the pool leases three keys, three requests go
out, and all three carry the first.

`tests/unit/rotating-stream-wire.test.ts` drives the real pi-ai adapter and asserts the
`Authorization` that reaches an observed request. Asserting `options.apiKey` against a
stubbed adapter cannot see any of this.

## Config

Under `extensions.tensorx-provider.config` in bundle settings:

| Key | Default | Meaning |
| --- | --- | --- |
| `cooldownMs` | 20000 | Rest after a 429 with no `retry-after` |
| `invalidCooldownMs` | 600000 | Rest after a 401/403 |
| `rotationBudgetMs` | 60000 | Ceiling on rotating and waiting before failing the request |

## The missing feature flag

Every other entrypoint in `extensions/my-stuff/` carries `featureFlag: "myStuff"`. This one
does not, and that is load-bearing rather than an oversight.

advisor drives pi with its own bundle settings (`advisorlib/advisor-pi-settings.json`),
which set `myStuff: false` and so disable the whole folder. advisor also selects `tensorx`
as its provider. Behind that flag, this extension would not register and every advisor run
would fail to resolve its model.

`tests/unit/tensorx-provider.test.ts` pins this: one case replays advisor's settings and
asserts the provider still registers. Turning it off per-extension through
`extensions.tensorx-provider.enabled` still works, which is the supported way to disable it.

## Inspecting

`/tensorx` prints one row per key with rotation state, cooldown remaining, in-flight count,
and per-key success, 429, auth-failure, and error counters. Key material is masked.
