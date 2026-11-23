# Prompts

Every instruction a model is given is a file here: versioned, reviewed and
loaded by name and version (`AGENTS.md`, section 6). No prompt text is
written in application code. The loader is `packages/ai/src/prompts.ts`;
its rules are in `docs/design/notes/m3-u4-llm-client.md`, section 6.

There is no prompt yet. The first, the reply prompt, is written with the
turn that uses it (M3 unit U7).

## Layout

```text
prompts/
  <name>/
    CHANGELOG.md          one heading for each version: "## 1", "## 2"
    <version>/            a whole number, 1 or more
      prompt.md
      meta.yaml
```

- A name is 1 to 40 of the letters a to z, digits and hyphens, and starts
  with a letter. A pack's own prompt is in the folder named for the pack
  (ADR 0014).
- **Each version has its own folder, and a merged version is not edited.**
  A change is a new version. A version written in a trace then means one
  text. No check can know what was merged before; this is kept by review.
- Which version runs is named in code and changed by pull request.

## `meta.yaml`

Exactly these keys:

```yaml
name: example            # the folder's name
version: 1               # the folder's version, as plain digits
owner: a name or a handle, not an email address
model: not-evaluated     # or the model this version was evaluated with
parameters: {}           # what it was evaluated with: numbers, short texts, true or false
intended_use: One or two sentences on what the prompt is for.
```

`model` and `parameters` are a record of an evaluation. The model a
deployment uses comes from its configuration.

## `prompt.md`

- UTF-8, at most 20,000 characters, with no tab and no carriage return.
- The core prompt holds `{{canary}}` exactly once, written exactly so. The
  loader puts the deployment's canary there, and a reply that repeats it is
  blocked (guardrail policy, O6). A pack's prompt holds none.
- **Nothing else is ever filled in.** Two opening or two closing braces
  together, anywhere else, are refused; an example that needs them writes
  them apart, as `{ {` and `} }`.
- No real conversation, and no real person's contact details. A test
  refuses an email address or seven or more digits in any file here; a
  date written as 2026-11-23 is allowed. An example of a conversation must
  be written for the prompt, never copied.
