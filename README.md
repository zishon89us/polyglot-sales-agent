# polyglot-sales-agent

A multilingual sales assistant for messaging channels. It answers customer
messages in whatever language the customer writes, using only the business's
own data, and turns the conversation into a booking or a confirmed order.

> **Status: inception (milestone M0).** There is no runnable product yet.
> See [`docs/STATUS.md`](docs/STATUS.md) for current progress.

## What it will be

- **Core engine** — receives messages, identifies the business (tenant),
  detects the language, retrieves the tenant's data, generates a grounded
  reply, and hands over to a human when needed.
- **Use-case packs** — configuration plus a small amount of code per use case.
  The first two are `booking` (appointments) and `cod-confirm`
  (cash-on-delivery order confirmation).
- **Owner dashboard** — edit business data, read conversations, take over a
  chat, see metrics.

The first channel is the WhatsApp Business Cloud API, behind a channel
interface so others can be added.

## How this project is built

This repository is developed by an AI coding agent (Claude) under the
direction of a human maintainer, who sets scope, makes the decisions listed in
`AGENTS.md`, and reviews and merges pull requests. The working agreement the
agent follows is in [`AGENTS.md`](AGENTS.md).

## Licence

[MIT](LICENSE)
