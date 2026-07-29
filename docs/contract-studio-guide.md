# Contract Studio guide

Contract Studio turns before-and-after examples into a deterministic Transformation Contract that can be inspected, challenged, guarded, approved, run, and checked locally.

Status: browser preview at `/contract`. It is not yet part of the primary navigation or public npm API.

## The five stages

### 1. Evidence

Add at least two representative input/output pairs or load a preset. JSON, XML, CSV, TOML, YAML, `.env`, and supported SQL input use the existing local data-format engine.

Examples are evidence of observed behavior. They do not prove that a mapping matches every business requirement.

### 2. Rule

Contract Studio shows the selected symbolic operations, their source and target paths, the examples that support each operation, input preconditions, and any unsupported behavior.

The rule is labeled **Observed, not yet approved** until a reviewer accepts an exact contract fingerprint.

### 3. Challenges

When several behaviors fit the examples or a runtime boundary is unresolved, Contract Studio shows one question at a time.

- An expected-output answer becomes a correction example and re-runs learning from the complete evidence set.
- A policy answer records a bounded runtime decision without fabricating evidence.
- Deferring a blocking question keeps approval blocked.
- Deferring an advisory question requires explicit acknowledgement during approval.

### 4. Guardrails

Recommended invariants come from the observed program, schemas, preconditions, and output policy. A checked recommendation is still only a draft until **Apply guardrails & test mutations** is selected.

The editor groups checks by input, output, record preservation, unseen values, and failure handling. Record and batch failure policies remain separate. A user may also opt into key preservation when a direct source-to-output identity mapping exists; that enables safe keyed reordering during check mode.

Mutation testing reports protected cases and visible gaps. It intentionally does not produce a trust score.

### 5. Approve and export

The review summary shows:

- operation and evidence counts;
- required inputs;
- blocking and advisory questions;
- accepted invariants;
- mutation detections and gaps;
- record and batch failure policy;
- the exact behavioral core fingerprint.

Approval binds to that fingerprint. Any behavioral edit creates a different fingerprint and clears approval. The current FNV-based fingerprint is deterministic change detection, not a security signature.

Contracts can be downloaded as JSON and imported again. Import validates the complete artifact and restores the same deterministic core. If another contract is already open, the Studio shows a path-level version comparison.

## Runtime review

An approved contract exposes two local modes:

- **Run contract** executes the approved symbolic program.
- **Check external output** computes the expected result and compares it with output produced elsewhere.

The first result states whether output can proceed. It then separates passed, warned, quarantined, and blocked records and provides row- and field-level evidence. Review records can be downloaded separately.

Privacy-safe report export removes raw record values and redacts invariant and diagnostic evidence. Downloading review records retains raw values and therefore requires an explicit confirmation.

## Local processing and sharing

Learning, challenge handling, invariant selection, mutation testing, approval, running, checking, import, and export happen in the browser. The Contract Studio module contains no network request path.

Share links are different: their URL fragment contains the examples, contract, and runtime drafts themselves. Contract Studio warns before creating one. Anyone who receives the link can read that data. Large states are refused and should be exported to a local file instead.

## Accessibility

- The progress control is a semantic tab list with arrow, Home, and End key handling.
- All editors and format controls have accessible labels.
- Status is expressed in text as well as color.
- Runtime evidence uses navigable disclosure rows.
- Live regions announce stage and blocking-state changes.
- Controls meet coarse-pointer targets.
- Layouts collapse at tablet, mobile, and 320 px widths.
- Reduced-motion preferences disable Contract Studio transitions.

## Current boundaries

Contract v1 does not support arbitrary code, external lookups, joins across datasets, nondeterministic operations, cryptographic approval signatures, hosted collaboration, or enterprise policy management. Unsupported behavior must remain visible rather than being guessed.
