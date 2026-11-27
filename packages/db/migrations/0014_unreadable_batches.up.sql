-- How many batches in a row a session got that could not be read: an
-- image, a voice note, a document and the like, with no text beside it
-- (order of checks, step 13; US-C12; design note
-- docs/design/notes/m3-u10a-emergency-unsupported.md, section 3). The
-- first two are answered with a fixed text; the third hands the session
-- over, and the count starts again.
ALTER TABLE sessions
  ADD COLUMN unreadable_batches integer NOT NULL DEFAULT 0
    CHECK (unreadable_batches BETWEEN 0 AND 3);
