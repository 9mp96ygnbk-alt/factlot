# FactLot Bench

**Do AI agents get commercial real estate numbers right, and does FactLot help?**

FactLot Bench is a set of realistic CRE agent tasks with lease and loan language as a user would
paste it. Each task has a ground-truth answer **computed independently of FactLot** (with decimal
arithmetic, the same values pinned in [`spec/vectors`](../spec)). Every task runs in two modes:

| Mode       | What the agent has                                                          |
| ---------- | --------------------------------------------------------------------------- |
| `baseline` | The model alone: no tools                                                   |
| `factlot`  | The model plus FactLot's calculators as tools (`factlot.anthropic_tools()`) |

A task passes only if **every** answer field is correct: numbers within the stated tolerance,
strings exactly.

## Tasks (v1)

There are 14 tasks: rent schedules (abatement, month-end commencement, cent rounding at scale),
net effective rent, CAM reconciliation (three cap methods and a base-year credit), loan sizing
(the binding constraint), WALT, tenant-side proposal comparison with NNN expenses, percentage rent,
and IRR (annualization and multiple roots). See [`tasks.json`](tasks.json).

## Run it

```bash
pip install anthropic
python bench/run.py --model <claude-model-id>            # both modes, all tasks
python bench/run.py --model <id> --modes factlot --tasks cam-yoy-cap,ner-discounted --repeats 3
```

Credentials come from `ANTHROPIC_API_KEY` or an `ant auth login` profile. Results are written to
`bench-results.json`, with per-task pass/fail, tool calls, token usage, and the final answer text,
plus a summary per mode.

**Cost.** One full run makes roughly 30–60 API calls. Run with `--repeats` to measure variance
before drawing conclusions.

## Offline tests

```bash
python -m unittest discover -s bench -p "test_*.py"
```

These tests make no API calls. They check that each task's ground truth is exactly reachable through
the FactLot reference tool calls, that scoring is strict, and that the tool-use loop works (against a
simulated client).

## Publishing results

Report the model ID, date, effort setting, repeats, and per-mode accuracy, and link the raw
`bench-results.json`. Don't publish a single run as a headline number.
