"""Executable model of the handover machine in docs/design/state-machines.md,
section 2. Not product code. It explores every sequence of events up to a
fixed depth and checks the invariants mechanically, so that they do not rest
on reading the table.

Run:  python3 docs/design/models/handover_machine.py

Model state: (state, window_open, followup_used, overdue)
  state          one of OPEN or TERMINAL below
  window_open    whether the contact's reply window is open
  followup_used  whether handover_followup has been sent for this handover
  overdue        whether it is currently marked overdue
"""
from collections import deque

OPEN = ("waiting", "in-progress", "detached", "followed-up")
TERMINAL = ("handed-back", "answered", "closed-unanswered")

# Events that need no person to act: timers and the session ending.
SILENT = ("session_ends", "escalation_elapses", "followup_7_days", "detached_14_days",
          "window_closes")
# Events caused by the customer or by staff.
ACTIONS = ("customer_message", "customer_call_or_keyword", "new_trigger", "staff_message",
           "staff_hand_back", "staff_close", "staff_followup_sent",
           "staff_followup_not_sent", "contact_opts_out", "contact_deleted")
EVENTS = SILENT + ACTIONS


def step(s, event):
    """Return the next model state, or None if the event cannot occur in s."""
    state, window, used, overdue = s
    if state in TERMINAL:
        return None

    attached = state in ("waiting", "in-progress")

    if event == "customer_message":
        # A customer message that reaches step 7 of the order of checks.
        if state in ("waiting", "in-progress"):
            return (state, True, used, overdue)
        if state == "detached":
            # Answered by the assistant in a new session; the handover stays.
            return ("detached", True, used, overdue)
        if state == "followed-up":
            return ("waiting", True, used, False)        # clock restarts

    if event == "customer_call_or_keyword":
        # A call, or a message that ends at step 5 (opt keyword) or step 6
        # (Confirm tap): it opens the reply window but is not a handover event.
        return (state, True, used, overdue)

    if event == "new_trigger":
        if attached:
            return (state, True, used, overdue)
        return ("waiting", True, used, False)            # detached or followed-up

    if event == "staff_message":
        if not window:
            return None                                  # staff cannot write
        return ("in-progress", window, used, False)

    if event == "staff_hand_back":
        if state == "waiting":
            return ("closed-unanswered", window, used, False)
        if state == "in-progress":
            return ("handed-back", window, used, False)
        return None

    if event == "staff_close":
        if state == "in-progress":
            return None                                  # hand back instead
        return ("closed-unanswered", window, used, False)

    if event in ("staff_followup_sent", "staff_followup_not_sent"):
        # Available when the reply window is closed, no staff message has been
        # sent, and no follow-up has been sent before.
        if state not in ("waiting", "detached") or window or used:
            return None
        if event == "staff_followup_sent":
            return ("followed-up", window, True, False)  # clock stops
        return (state, window, used, overdue)

    if event == "session_ends":
        # 24 hours with no message in either direction, so the window is closed.
        if state == "waiting":
            return ("detached", False, used, overdue)
        if state == "in-progress":
            return ("answered", False, used, False)
        return None

    if event == "window_closes":
        if not window:
            return None
        if attached:
            # While attached the session is active; the window can close before
            # the session ends only if the last message was outbound.
            return (state, False, used, overdue)
        return (state, False, used, overdue)

    if event == "escalation_elapses":
        # Counts business time in waiting and detached; stopped otherwise.
        if state in ("waiting", "detached") and not overdue:
            return (state, window, used, True)
        return None

    if event == "followup_7_days":
        if state == "followed-up":
            return ("closed-unanswered", window, used, False)
        return None

    if event == "detached_14_days":
        if state == "detached":
            return ("closed-unanswered", window, used, False)
        return None

    if event == "contact_opts_out":
        return (state, window, used, overdue)

    if event == "contact_deleted":
        if state == "in-progress":
            return ("answered", False, used, False)
        return ("closed-unanswered", False, used, False)

    raise AssertionError(f"unhandled event {event}")


def explore(depth):
    start = ("waiting", True, False, False)
    seen = {start}
    frontier = deque([(start, 0)])
    edges = set()
    while frontier:
        s, d = frontier.popleft()
        if d == depth or s[0] in TERMINAL:
            continue
        for e in EVENTS:
            n = step(s, e)
            if n is None:
                continue
            edges.add((s[0], e, n[0]))
            if n not in seen:
                seen.add(n)
                frontier.append((n, d + 1))
    return seen, edges


def ends_in_silence(s, limit=10):
    """With no customer or staff action, does the handover reach a terminal
    state? Timers fire in the only order they can."""
    for _ in range(limit):
        if s[0] in TERMINAL:
            return True
        moved = False
        for e in ("session_ends", "followup_7_days", "detached_14_days"):
            n = step(s, e)
            if n is not None:
                s, moved = n, True
                break
        if not moved:
            return False
    return s[0] in TERMINAL


def main():
    seen, edges = explore(depth=8)
    states = {s[0] for s in seen}

    # Every state named in the document is reachable.
    assert states == set(OPEN) | set(TERMINAL), states

    # H2: from every reachable open state, with no one acting, the handover ends.
    stuck = [s for s in seen if s[0] in OPEN and not ends_in_silence(s)]
    assert not stuck, stuck

    # H1: no event creates a second handover. The model holds one handover per
    # contact, and a new trigger is defined in every open state.
    for s in seen:
        if s[0] in OPEN:
            assert step(s, "new_trigger") is not None, s

    # H3 / S1: the session is handed over exactly in waiting and in-progress.
    # A customer message in detached must not hand the session over.
    for s in seen:
        if s[0] == "detached":
            assert step(s, "customer_message")[0] == "detached"
        if s[0] == "followed-up":
            assert step(s, "customer_message")[0] == "waiting"

    # A staff message always answers the handover when it can be sent, and it
    # can be sent in every open state whose reply window is open.
    for s in seen:
        if s[0] in OPEN and s[1]:
            assert step(s, "staff_message")[0] == "in-progress", s

    # At most one follow-up per handover.
    for s in seen:
        if s[2]:
            assert step(s, "staff_followup_sent") is None, s

    # An unanswered handover can become overdue in detached (finding V4).
    assert ("detached", "escalation_elapses", "detached") in edges

    print(f"reachable model states: {len(seen)}")
    print(f"handover states reached: {sorted(states)}")
    print("transitions between handover states:")
    for a, e, b in sorted({(a, e, b) for a, e, b in edges if a != b}):
        print(f"  {a:12s} --{e}--> {b}")
    print("all checks passed")


if __name__ == "__main__":
    main()
