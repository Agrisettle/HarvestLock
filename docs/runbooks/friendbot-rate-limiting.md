# Runbook: Stellar Testnet Friendbot Rate-Limiting

Use this when a testnet flow cannot fund a fresh Stellar account, especially
when several live integration tests are run back-to-back. Friendbot is the
public testnet funding service; it is not part of HarvestLock production
transaction processing.

## Symptoms

- The test helper reports `friendbot funding failed for <public key>` and
  includes a non-success HTTP response from `https://friendbot.stellar.org`.
- An account-funding request fails with a network error such as `fetch failed`,
  `ENETUNREACH`, or `ETIMEDOUT`.
- A freshly generated signer cannot authorize a testnet operation because its
  account has not yet appeared on the testnet ledger.

The API handoff records repeated friendbot failures during rapid test runs,
including connection failures plausibly associated with burst rate limiting.
The exact response and service status can vary, so confirm the account state
before concluding that a failure is a rate limit.

## Confirm

1. Check that the address is a testnet public address (`G...`) and that the
   test is configured for Stellar testnet. Never send a secret key to
   Friendbot; it only needs the public address.

2. Check whether the testnet account already exists using the public Horizon
   endpoint:

   ```sh
   curl -i "https://horizon-testnet.stellar.org/accounts/$PUBLIC_KEY"
   ```

   A successful account response means funding already landed; continue the
   test without requesting another Friendbot payment. A not-found response
   means the account is not yet visible on Horizon.

3. If the account is absent, inspect Friendbot's HTTP status and response:

   ```sh
   curl -i "https://friendbot.stellar.org/?addr=$PUBLIC_KEY"
   ```

   Record the time and status. A non-success response is a funding-service
   failure, not evidence that the HarvestLock contract or API is broken.

## Recover

1. Stop repeatedly rerunning the entire live test suite. Those tests create
   fresh accounts, so a rapid rerun can increase funding requests without
   helping an account whose first request is still propagating.

2. If Friendbot reports a temporary failure or the request times out, pause
   the funding attempts and check the account again through Horizon before
   requesting more test XLM. Do not build a replacement signer until the
   expected account is funded and visible.

3. Run only the affected live test once the funding service is responding and
   the required accounts exist. The network-free API tests can be run
   separately while testnet funding is unavailable.

4. If Friendbot continues failing, check Stellar's testnet service status and
   report the UTC time, public account address, Friendbot status/body, and
   Horizon result to the project maintainers. Public addresses are not secret;
   never include a seed phrase or private key.

## Avoid false alarms

The API handoff also records transient Soroban RPC failures such as `Account
not found` for a funded account and `fetch failed` during RPC polling. Those
are separate from Friendbot funding. Confirm the account through Horizon; if
it exists, investigate the RPC/API logs and retry the specific read or test
after the transient failure clears rather than funding the account again.