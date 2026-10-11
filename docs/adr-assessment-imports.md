# ADR: separate historical assessments from native verification

Status: accepted for the bounded import implementation.

Security-contract and agent-behavior evaluators complement generation and test routing. Their reports can contain partial runs, ungraded cases, omitted checks and aggregate scores over narrower evidence. Treating those scores as native validation would erase uncertainty and create competing acceptance authorities.

Add an `assessment-import` plugin kind, with only `enabled` and an optional project-relative `report`. Guardana and iFixAi have independent pure native-format normalizers; the shared application boundary handles bounded reads, duplicate-key rejection, hashing, private receipts and explicit historical authority. CLI `assess` imports enabled reports or an explicitly supplied one-off report. Health checks and recommendation inspection remain runner-free for these adapters. No executable configuration is accepted.

Partial, missing and contradictory evidence cannot become a clean assessment through an aggregate score. The current iFixAi export lacks enough classification/provenance metadata to establish completeness, so passing grades remain incomplete. Producer claims never enter native acceptance, routing evidence or learning promotion stores.

Acceptance includes native-shaped synthetic fixtures, adversarial coverage-loss and parser tests, independent boundary review, and actual CLI import/refusal checks in the sealed production-only installation. These prove implementation behavior; live evaluator efficacy, general speed gains and learning gains require separate campaigns.

This bounded scope avoids silently activating expensive endpoint probes. A future live capability must have its own explicit policy and finite budgets rather than adding commands to report-import settings.
