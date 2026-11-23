// The test page: play a customer by hand, and see what the product sent.
// Everything is put on the page as text, never as markup.

export const TEST_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>mock-whatsapp</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 2rem auto; max-width: 40rem; padding: 0 1rem; }
  label { display: block; margin-top: 1rem; }
  input, textarea, button { font: inherit; width: 100%; box-sizing: border-box; padding: 0.4rem; }
  button { margin-top: 1rem; width: auto; }
  li { margin: 0.5rem 0; white-space: pre-wrap; }
  .note { color: #555; }
</style>
</head>
<body>
<h1>mock-whatsapp</h1>
<p class="note">A stand-in for WhatsApp, for development only. Nothing here reaches a real phone.</p>
<form id="send">
  <label>Business number ID <input name="phoneNumberId" required value="100000000000002"></label>
  <label>Customer's number (leave empty for a customer with a username) <input name="from" value="+15550142"></label>
  <label>Message <textarea name="text" required rows="3" dir="auto"></textarea></label>
  <label><input type="checkbox" name="asCaption" style="width: auto"> Send it as the caption of a picture</label>
  <button>Send as the customer</button>
</form>
<p id="result" role="status"></p>
<h2>Sent by the product</h2>
<ul id="sent"></ul>
<script>
  const result = document.getElementById("result");
  const list = document.getElementById("sent");
  async function refresh() {
    const { sent } = await (await fetch("/mock/sent")).json();
    list.replaceChildren(...sent.map((message) => {
      const item = document.createElement("li");
      item.dir = "auto";
      item.textContent = (message.to ?? message.recipient) + ": " + message.body;
      // A reply button, to tap as the customer who was sent the message.
      for (const button of message.buttons ?? []) {
        const tap = document.createElement("button");
        tap.type = "button";
        tap.textContent = button.title;
        tap.addEventListener("click", () => deliver({
          phoneNumberId: message.phoneNumberId,
          ...(message.to === null ? {} : { from: message.to }),
          button: { id: button.id, title: button.title, replyTo: message.id },
        }));
        item.append(document.createElement("br"), tap);
      }
      return item;
    }));
  }
  document.getElementById("send").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    if (data.from === "") delete data.from;
    if (data.asCaption !== undefined) {
      data.caption = data.text;
      delete data.text;
    }
    delete data.asCaption;
    deliver(data);
  });
  async function deliver(data) {
    const response = await fetch("/mock/inbound", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    const answer = await response.json();
    result.textContent = response.ok
      ? "Delivered to the webhook, which answered " + answer.webhookStatus
      : "Not delivered: " + answer.error;
    refresh();
  }
  refresh();
  setInterval(refresh, 2000);
</script>
</body>
</html>
`;
