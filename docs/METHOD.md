# Measurement method

**Tickets.** 54 fictional support tickets (the runs recorded on 13 Nov 2026 used the first 48; the last six add repeated first names, phone numbers outside North America, apartment lines and a surname used on its own) with known answers (`packages/core/src/data/tickets.json`, shared with the Android app): tidy and messy, with typos, capitals, missing order numbers, several phone and address formats, and messages that are not about an order. Categories are defined in the instruction so each ticket has one defensible answer. Replies are tested on the first 24, masked; summaries on threads of increasing length.

**Pairs.** Every input runs once on the device (`ONLY_ON_DEVICE`) and once in the cloud (`ONLY_IN_CLOUD`), after one warm-up call that records the model load time. Both sides get the same structured-output schema (`responseSchema` in the cloud, `responseConstraint` on the device) and text-only input options. The cloud runs at temperature 0.

**Format check.** The output must match the task's validator:
- JSON schema for extraction
- an allowed label for triage
- a word limit with refusal detection for free text

**Scoring.**
- Triage: the label must match the gold label.
- Extraction: the order ID and product must match the gold fields.
- Finding personal details: the details found, plus emails and phone numbers caught by rules, are masked in code; the score is whether any of the gold personal details would still reach the cloud. This measures the pipeline as shipped (the model plus the rules), not the model alone, and it does not penalise hiding words that are not personal details.
- Free text: a separate cloud judge model scores both answers blind, in random order, on the same rubric.

**Acceptable.** The device answer passes the format check and scores at least 4 out of 5. For judged tasks it must also be no more than one point below the cloud answer.

**Exclusions.** A failed cloud reference or judge call excludes that pair. It never counts against the device. Excluded pairs are reported.

**Route.**
- **Device first (device only for personal data):** the one-sided 95% Wilson lower bound of the acceptable rate is at least 0.7, and the device p90 latency is within the feature's budget. If personal data is involved and the device is too slow, a warning is shown instead.
- **Device only for personal data on a smaller sample:** if the bound falls short but at least 85% of answers were acceptable, a step that reads personal data stays on the device, with a warning that more inputs are needed to be 95% sure.
- **Cloud first:** the rate is at least 0.5 but the evidence or the speed falls short.
- **Cloud only:** anything lower.
- With fewer than 4 usable samples the result is marked inconclusive and stays cloud first.

**Choosing a model per step (Android).** When a phone has complete runs on more than one on-device model, each step gets the quickest model whose 95% lower bound clears the step's bar: 0.9 for finding personal details, because a missed name reaches the cloud, and 0.7 for the other steps. If no model clears the bar, the one with the strongest evidence is kept. The web routes use the single 0.7 bar above, with one on-device model per browser.

**Length limit.** Length-sweep tasks run at 150, 800, 2,000, 4,000 and 6,000 words. The limit is the largest size where that size and every smaller size reach a 75% acceptable rate.

**Replies are tested as they are used.** Reply inputs are the tickets with personal details already replaced by placeholders, exactly as Shopdesk sends them.

**Time limits.** A cloud answer that takes longer than 60 seconds, or an on-device answer that takes longer than 90 seconds, counts as a failed answer. A reviewer that keeps returning server errors is skipped for the rest of the run. Each finished feature is saved as soon as it completes, so a run stopped part-way keeps its results.

**Reviewers.** Written answers are reviewed by a model other than the one that produced the cloud answers. When a reviewer's daily allowance runs out, the next one takes over; the report records which model reviewed each answer.

**What is not estimated.** The app shows no invented volumes or savings. Shopdesk counts the real steps of the current visit, and the share of users with Gemini Nano is quoted from one published production measurement.

**Limits.** Results describe the calibrating browser and hardware. The tickets are fictional and written by one author, so the confidence bounds describe how the model did on this set, not on every shop's real traffic; a shop should calibrate on its own (consented) tickets before trusting a route. The set is in English only, which is also the language Firebase validates for on-device use. Mobile on-device models have a smaller context (about 4,000 tokens), so exported mobile limits are capped at 2,500 words and should be re-measured on those devices.

**Android differences.** On Android the on-device model gets the same instruction but no output schema (the web passes one to Chrome); answers are checked by the same rules afterwards. Only the steps with known answers (sorting, order details, personal details) are calibrated on the phone.
