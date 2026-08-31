# CONTEXT

Glossary for this repo. Terms only, no implementation detail.

| Term | Meaning |
|---|---|
| **named agent** | A user-configured spawn target with a stable name (e.g. `opus`, `fable`) bound to a model and thinking level |
| **default set** | The list of named agents used when the user says “the agents” or does not name one |
| **brief** | The confirmed prompt text sent to every spawned agent for a run |
| **spawn run** | One fan-out: N child Pi agents given the same brief, then collected |
| **finding** | One child agent’s written answer for a run (temp file, discarded after the parent report) |
| **headless spawn** | Running child Pi without Herdr tabs (default outside Herdr, or when the user asks for background) |
