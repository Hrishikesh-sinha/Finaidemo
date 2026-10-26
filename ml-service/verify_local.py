"""Verify that a locally running ml-service really is using Chronos-2.

Run this after starting the service (see RUNNING_LOCALLY.md):

    python verify_local.py                      # defaults to http://localhost:8000
    python verify_local.py http://localhost:8000

It triggers the model load, waits for it, then checks that a 52-week request
comes back as chronos-2 and a 12-week request still falls back to the moving
average. Standard library only, so it needs no extra packages.

Exit code 0 means Chronos-2 genuinely produced the forecast. Anything else
means it did not, and the output says why.
"""

from __future__ import annotations

import json
import math
import sys
import time
import urllib.error
import urllib.request

WAIT_SECONDS = 1800          # first load downloads ~500MB
POLL_EVERY = 15


def call(base: str, path: str, payload=None, timeout: int = 60):
    url = base.rstrip("/") + path
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def weekly_history(n: int) -> list:
    """A plausible weekly-spend series: trend, seasonality, mild noise."""
    out = []
    for i in range(n):
        base = 8000 + i * 25
        seasonal = 600 * math.sin(i / 8.0)
        noise = ((i * 53) % 400) - 200
        out.append(round(base + seasonal + noise, 2))
    return out


def main() -> int:
    base = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
    print(f"service: {base}\n")

    # 1. Is it up at all?
    try:
        health = call(base, "/health", timeout=10)
    except (urllib.error.URLError, OSError) as exc:
        print(f"FAIL  cannot reach {base}/health -- {exc}")
        print("      Is the service running? See RUNNING_LOCALLY.md.")
        return 2

    print(f"health: {health}")
    state = health.get("chronos_state", "unknown")

    # 2. The load is lazy, so nudge it with a real request.
    if state == "not_started":
        print("\nmodel not loaded yet; sending a request to start the load")
        try:
            call(base, "/forecast", {"history": weekly_history(52), "horizon": 4}, timeout=30)
        except (urllib.error.URLError, OSError) as exc:
            print(f"FAIL  /forecast errored -- {exc}")
            return 2

    # 3. Wait for it. The first run downloads the weights.
    waited = 0
    while state in ("not_started", "loading") and waited < WAIT_SECONDS:
        time.sleep(POLL_EVERY)
        waited += POLL_EVERY
        try:
            state = call(base, "/health", timeout=10).get("chronos_state", "unknown")
        except (urllib.error.URLError, OSError) as exc:
            print(f"  ... /health unreachable after {waited}s -- {exc}")
            continue
        print(f"  ... {waited:>4}s  chronos_state={state}")

    if state != "ready":
        print(f"\nFAIL  chronos_state is {state!r}, not 'ready'")
        if state == "failed":
            print("      The load failed. Check the service's own log output for the")
            print("      reason -- usually no network, or no cached weights.")
        else:
            print(f"      Still not ready after {WAIT_SECONDS}s.")
        return 1

    print(f"\nchronos_state=ready after {waited}s\n")

    ok = True

    # 4. 52 weeks must use the model.
    r52 = call(base, "/forecast", {"history": weekly_history(52), "horizon": 4}, timeout=120)
    print("52 weeks of history:")
    print("  " + json.dumps(r52, indent=2).replace("\n", "\n  "))
    for label, cond in [
        ('model == "chronos-2"', r52.get("model") == "chronos-2"),
        ("reason is null", r52.get("reason") is None),
        ("4 forecast points", len(r52.get("forecast") or []) == 4),
        ("weeks_of_history == 52", r52.get("weeks_of_history") == 52),
        ("lower < forecast < upper", all(
            l < f < u for l, f, u in zip(
                r52.get("lower") or [], r52.get("forecast") or [], r52.get("upper") or []))),
    ]:
        print(f"  [{'PASS' if cond else 'FAIL'}] {label}")
        ok &= bool(cond)

    # 5. 12 weeks must still refuse the model.
    r12 = call(base, "/forecast", {"history": weekly_history(12), "horizon": 4}, timeout=60)
    print("\n12 weeks of history (should NOT use the model):")
    print(f"  model={r12.get('model')!r}")
    print(f"  reason={r12.get('reason')!r}")
    for label, cond in [
        ('model == "moving_average"', r12.get("model") == "moving_average"),
        ("reason explains why", bool(r12.get("reason"))),
    ]:
        print(f"  [{'PASS' if cond else 'FAIL'}] {label}")
        ok &= bool(cond)

    print("\n" + ("PASS: Chronos-2 produced the 52-week forecast."
                  if ok else "FAIL: see the checks above."))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
