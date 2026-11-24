# Product

## Users

ML and media engineers who run an open video model on their own GPU and must
keep every output traceable as it ages, plus the AI coding agents that extend
this sample for them. Their context: clips pile up fast, and a clip without its
prompt, seed and exact model version cannot be explained, reproduced or safely
shared once it leaves the working folder.

## Product Purpose

Generate short clips with Wan2.2 TI2V-5B through Diffusers on one GPU, at a
pinned model revision, and keep each clip in Backblaze B2 with a manifest entry
that records its prompt, seed, model, revision, license and checksum. An age job
moves older clips to an archive prefix and rewrites their manifest keys; any
clip can be shared through an expiring presigned link or regenerated from its
manifest entry. Success = an engineer can point at any clip, months later, and
say exactly how it was made, where it lives, and who can open it.

Out of scope: transcoding, streaming, multi-GPU or batch scheduling, fine-tuning,
user accounts, image-to-video conditioning, and any model whose license
restricts commercial use.

## Maturity and Support Boundary

This is a maintained open-source sample, not a hosted video service. It is built
with production-minded controls and can be adapted for production use with
caution, but adopters own product-specific validation, security, deployment and
operations. Repository defects and feature requests go through the public GitHub
issue tracker; B2 account, billing, service and API questions go through
Backblaze Support. The sample is not covered by the Backblaze service level
agreement, and no SLA is provided for the repository software.

## Brand Personality

Precise, calm, factual. The interface reads like an engineering tool: it shows
the seed, the 40-hex revision and the checksum rather than hiding them, and it
labels every clip as AI-generated without ceremony.

## Anti-references

- **Generative-media hype.** No gradient hero, no showreel autoplay wall, no
  "magic" language. The clips are outputs to be tracked, not a gallery to sell.
- **Hidden provenance.** Never show a clip without a path to its full manifest
  entry, and never imply a clip can be edited after the fact.
- **Toy / prototype feel.** No missing loading, empty or error states.

## Design Principles

- **Provenance first.** Every screen that shows a clip links to its prompt, seed,
  model revision and checksum.
- **Safe defaults, visible.** Forms show their defaults as placeholders and
  descriptions; destructive and storage-moving actions default to dry run or
  ask for confirmation.
- **One source of truth.** The manifest decides where a clip is; the UI reads
  manifests, not bucket listings, for anything clip-shaped.
- **Every state is designed.** Default, loading, empty, error, queued, running,
  failed.

## Accessibility & Inclusion

Target **WCAG 2.1 AA**. Body text ≥ 4.5:1, visible focus indicators, full
keyboard navigation (the share lifetime control is a radio group), labelled form
controls, `aria-live` job progress, and a `prefers-reduced-motion` alternative
for every animation. Full light and dark theme parity.
