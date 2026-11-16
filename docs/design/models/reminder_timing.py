"""Reference model of the reminder timing rule in docs/design/state-machines.md.
Not product code: it exists to check the worked examples in that document."""
from datetime import datetime, timedelta, time

MIN = timedelta(minutes=1)
FLOOR = timedelta(minutes=60)


def quiet_period(t, q_start, q_end):
    """Return (start, end) of the quiet period containing t, or None.
    The start time is inside quiet hours; the end time is outside."""
    for day_offset in (-1, 0):
        d = (t + timedelta(days=day_offset)).date()
        s = datetime.combine(d, q_start)
        e = datetime.combine(d, q_end)
        if e <= s:
            e += timedelta(days=1)
        if s <= t < e:
            return s, e
    return None


def schedule(now, start, lead, q_start=time(22, 0), q_end=time(8, 0)):
    due = start - lead
    if due < now:
        return ("none", "nearer than lead time")
    q = quiet_period(due, q_start, q_end)
    if q is None:
        return ("scheduled", due)
    before = q[0] - MIN
    if before > now:
        return ("scheduled", before)
    if q[1] <= start - FLOOR:
        return ("scheduled", q[1])
    return ("withheld", "too-late")


def d(day, hh, mm=0):
    # day 16 = Monday 2026-11-16
    return datetime(2026, 11, day, hh, mm)


H = timedelta(hours=1)
CASES = [
    ("1 booked Mon 10:00 for Wed 07:30, lead 24h", d(16, 10), d(18, 7, 30), 24 * H),
    ("2 booked Mon 23:00 for Wed 07:30, lead 24h", d(16, 23), d(18, 7, 30), 24 * H),
    ("3 booked Tue 07:00 for Tue 08:30, lead 1h", d(17, 7), d(17, 8, 30), 1 * H),
    ("4 booked Mon 12:00 for Mon 20:00, lead 24h", d(16, 12), d(16, 20), 24 * H),
    ("5 moved on Tue 09:00 to Tue 15:00, lead 24h", d(17, 9), d(17, 15), 24 * H),
    ("6 booked Mon 10:00 for Wed 22:00, lead 24h", d(16, 10), d(18, 22), 24 * H),
    ("7 booked Mon 10:00 for Wed 08:00, lead 24h", d(16, 10), d(18, 8), 24 * H),
    ("8 booked Mon 21:59:30 for Wed 07:30, lead 24h", datetime(2026, 11, 16, 21, 59, 30), d(18, 7, 30), 24 * H),
    ("9 booked Tue 06:00 for Tue 09:30, lead 2h", d(17, 6), d(17, 9, 30), 2 * H),
]

if __name__ == "__main__":
    for name, now, start, lead in CASES:
        kind, val = schedule(now, start, lead)
        shown = val.strftime("%a %H:%M") if isinstance(val, datetime) else val
        print(f"{name:48s} -> {kind}: {shown}")
