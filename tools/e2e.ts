// The end-to-end check of the walking skeleton (M2 exit criterion): send a
// message through the stand-in for WhatsApp as a customer, and wait for the
// product's echo to come back to that customer.
//
//   node tools/e2e.ts            against http://127.0.0.1:4010
//
// It talks only to the mock's own address. The product is whatever is
// running behind it: the processes of `docker compose up`, or the ones a
// test starts.

export interface RoundTripOptions {
  /** The mock's address. */
  readonly mockUrl: string;
  /** The receiving number's identifier, as connected to a tenant. */
  readonly numberId: string;
  /** The customer's number. From the range kept for fiction. */
  readonly from?: string;
  /** How long to wait for the stack to come up and for the echo, each. */
  readonly timeoutMs?: number;
}

export interface RoundTripText {
  /** The text to send, in place of one made up. */
  readonly text?: string;
  /** The reply to wait for, in place of the text's echo. */
  readonly reply?: string;
}

export interface RoundTrip {
  readonly sent: string;
  readonly received: string;
  readonly ms: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Sent {
  readonly phoneNumberId: string;
  readonly to: string | null;
  readonly body: string;
}

/**
 * Sends one message and returns when its echo has arrived. Throws, saying
 * which step did not happen, if the time runs out.
 */
export async function echoRoundTrip(options: RoundTripOptions & RoundTripText): Promise<RoundTrip> {
  const from = options.from ?? "+15550142";
  const timeoutMs = options.timeoutMs ?? 120_000;
  // Unlike any other message, so that an echo of an earlier run is not taken for this one's.
  // Letters only: the stand-in model echoes the text, and a reply with a
  // number in it that the business never stored is held back (M3 U9).
  const letters = Array.from({ length: 20 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26)),
  ).join("");
  const text = options.text ?? `end to end ${letters}`;
  const wanted = options.reply ?? `Echo: ${text}`;
  const started = Date.now();

  // The webhook is delivered: the mock is up, the API is up and it stored the message.
  let delivered = false;
  let last = "the mock did not answer";
  while (!delivered && Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${options.mockUrl}/mock/inbound`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phoneNumberId: options.numberId, from, text }),
      });
      const answer = (await response.json()) as { webhookStatus?: number };
      delivered = response.ok && answer.webhookStatus === 200;
      last = `the mock answered ${response.status} and the webhook ${answer.webhookStatus ?? "nothing"}`;
    } catch {
      last = "the mock did not answer";
    }
    if (!delivered) {
      await sleep(500);
    }
  }
  if (!delivered) {
    throw new Error(`e2e: the message was not delivered to the webhook: ${last}`);
  }

  const delivery = Date.now();
  while (Date.now() - delivery < timeoutMs) {
    const response = await fetch(`${options.mockUrl}/mock/sent`);
    const { sent } = (await response.json()) as { sent: Sent[] };
    const echo = sent.find(
      (message) =>
        // The first reply of a session begins with the disclosure, a blank line before the echo.
        (message.body === wanted || message.body.endsWith(`\n\n${wanted}`)) &&
        message.to === from &&
        message.phoneNumberId === options.numberId,
    );
    if (echo !== undefined) {
      // Exactly one: a second copy would be a duplicate reply. Looked for again a moment
      // later, since a second copy would not arrive in the same instant as the first.
      await sleep(1_000);
      const again = (await (await fetch(`${options.mockUrl}/mock/sent`)).json()) as {
        sent: Sent[];
      };
      const copies = again.sent.filter(
        (message) => message.body === echo.body && message.to === from,
      ).length;
      if (copies !== 1) {
        throw new Error(`e2e: the echo arrived ${copies} times`);
      }
      return { sent: text, received: echo.body, ms: Date.now() - started };
    }
    await sleep(200);
  }
  throw new Error("e2e: the webhook took the message, but no echo came back");
}

if (import.meta.main) {
  try {
    const result = await echoRoundTrip({
      mockUrl: process.env["PSA_E2E_MOCK_URL"] ?? "http://127.0.0.1:4010",
      numberId: process.env["PSA_DEV_NUMBER_ID"] ?? "100000000000002",
    });
    console.log(`e2e: sent a message and received its echo in ${result.ms} ms`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "e2e: failed");
    process.exit(1);
  }
}
