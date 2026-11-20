# HarvestLock: a plain-language guide

HarvestLock helps a cooperative and a buyer agree how payment will be held and released as an order moves from agreement to delivery. The cooperative does not need to understand cryptocurrency to follow the steps, but the first version uses a few new tools. This guide explains them in everyday terms.

## Three terms

**Stellar** is a shared payment network. It records transfers and keeps a consistent record that the buyer, cooperative, and warehouse can check.

**Testnet** is Stellar's practice network. It behaves like the real network for testing, but its tokens have no cash value. HarvestLock currently uses testnet, so money shown in a test commitment is not real money and cannot be exchanged for cash.

A **Soroban contract** is a small program on Stellar that follows agreed payment rules. In HarvestLock, it holds the testnet funds and releases them when the required steps happen. It applies the same rules for everyone; it is not a person who can make exceptions or reverse a completed action.

**Freighter** is a browser wallet used to approve actions on Stellar. Think of it as a key kept by the person or organization using it. When HarvestLock asks for approval, Freighter shows a request for that wallet to sign. HarvestLock should never ask you to send it your password or recovery phrase.

## What you will do

1. Open Freighter and make sure it is set to Stellar testnet.
2. Open the HarvestLock page and connect the wallet your organization will use.
3. Review the commitment details with the buyer before approving anything. Check the amount, delivery terms, deadlines, and the wallet addresses shown.
4. When an action is needed, HarvestLock prepares it and Freighter asks you to approve it. Read the request before you approve. Some actions need approval from more than one party; each party approves from their own wallet.
5. Return to HarvestLock to check the recorded status. A deadline is displayed in UTC, the same clock time for everyone, rather than your device's local time.

## Keep the wallet safe

- Use a wallet controlled by your cooperative and follow your organization's approval process.
- Never share a recovery phrase, private key, or wallet password with a buyer, a warehouse, or HarvestLock support.
- A wallet approval can be difficult or impossible to undo once recorded. Check the details before approving.
- If the wallet or network shows something unexpected, pause and ask a trusted technical contact before continuing.

HarvestLock's current testnet version is for learning and testing, not for transferring real cooperative funds. The screens and steps may change as the service is tested with cooperatives.