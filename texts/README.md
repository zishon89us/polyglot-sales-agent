# Fixed texts

What code sends to a customer in the business's name, word for word: the
disclosure, the answer to "am I talking to a person?", the fallback and
the rest. **No model writes or changes these** (guardrail policy, section
7). The rules are in `docs/design/notes/m3-u8-fixed-texts.md`; the reader
is `packages/core/src/texts.ts`, and a worker that finds a file breaking a
rule does not start.

## Layout

```text
texts/
  fixed/
    <version>/            a whole number, 1 or more
      <language>.json     one file for one language: en.json, ar.json
```

A file holds exactly `language`, `texts` and `buttons`: every text by its
name, each with the buttons the code says it carries, and a title for each
of the three buttons. A text is at most 300 UTF-16 units and the
disclosure at most 150; a button's title at most 16. `{{opening}}` and
`{{contact}}` are places that code fills in, in the one text that has
them.

Which version the code sends is `FIXED_TEXTS_VERSION` in
`packages/core/src/texts.ts`, changed by pull request. A merged version is
not edited once customers have been sent it: a change of wording is a new
version, so that a message on record can be traced to the words it had.
No check can know what was merged before; this is kept by review.

## Languages

A text is sent in the customer's language when that language is one of
the supported ones and has a file here; else in the business's default
language if that has a file; else in English.

Version 1:

| Language | File | Wording by |
| --- | --- | --- |
| `en` English | yes | the agent; not yet read by the maintainer (decisions, row 51) |
| `ar` Arabic | **no** | |
| `ur` Urdu | **no** | |
| `hi` Hindi | **no** | |
| `bn` Bengali | **no** | |
| `tl` Tagalog | **no** | |

So today **every fixed text is sent in English**, to every customer. A
translation is wording a customer reads in the business's name, and the
agent does not write one without a reader of that language to check it
(decisions, row 51). A test fails if this table and the files disagree.
