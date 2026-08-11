# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Borealis serves three situations, and the owner has confirmed all three are
in scope rather than one being primary:

1. **A self-hoster sending files outward** to friends, clients, and people met
   over the internet — recipients who have no account and are not fully trusted.
   This is the originating use case and the one that shaped the product.
2. **A small team** using an instance as shared infrastructure, with accounts,
   folders, and per-user administration.
3. **An individual** treating it as a personal store, browsing and searching
   their own files, with sharing as a secondary action.

The recipient is a first-class user even though they never sign in. They arrive
cold at a link, often on a phone, sometimes needing a password, and must
understand what they have been given and how long it lasts.

## Product Purpose

Self-hosted file sharing that lets someone hand a file to a stranger without
handing over anything else. It exists because sharing files with untrusted
people normally means either trusting a third-party service or exposing your own
server. Success is the owner sending a link to someone they don't fully trust
and having no reason to worry afterwards — no lingering access, no runaway
bandwidth bill, no doubt about who fetched what.

## Positioning

The owner has chosen to carry all three of these together rather than lead with
one:

- **Control over a leaked link.** Password, expiry, download caps, egress caps,
  and a per-share audit trail. A leaked link is a bounded event, not a breach.
- **Privacy the host cannot break.** Optional zero-knowledge shares where the
  file is encrypted in the browser and the server never sees plaintext or key.
- **No artificial limits.** Resumable multi-gigabyte uploads, recipients need no
  account, and the only ceiling is the operator's own disk.

The defensible combination is the first two: most self-hosted file hosts offer
sharing, very few offer *containment* (caps and audit) or *zero-knowledge*, and
essentially none offer both.

## Operating Context

Deployed by the operator onto their own VPS or homelab, typically as a container
behind a reverse proxy, and expected to run unattended for long periods. The
operator is technical; the recipient is usually not. Links are pasted into chat
apps and email, so they are opened on unpredictable devices and often on mobile.

## Capabilities and Constraints

Confirmed and working today: email/password and OAuth/OIDC sign-in, gated by
single-use invitation codes; resumable uploads via tus; owner-only file
download; shares carrying multiple files with password protection, expiry,
download caps, and egress caps; per-share access logging including failed
unlock attempts; public share page with password unlock; reverse shares, where
a link collects files from people with no account; zero-knowledge shares, where
the file is encrypted in the browser and the key rides in the URL fragment;
full-text search across filenames and extracted document text; an admin panel;
deletion governed by role (owners always, admins over ordinary users' files,
root over everything); and email for address verification and password reset.

Storage is either the local filesystem or any S3-compatible service. The
database is SQLite by default or PostgreSQL by configuration.

Two things the interface must still not claim. **OCR**: text is extracted from
plain text, PDF, and DOCX only, so a scanned image is stored and served but
never indexed. **Download notification**: the field exists on a share and the
mail transport works, but nothing sends that message yet.

On zero-knowledge, the interface must be exact about the boundary. The bytes
are unreadable to the server; the filename, size, and content type are not. The
key exists only in the browser that made it, so clearing site data destroys the
file for everyone including its owner, and a link that loses its fragment
cannot be repaired by the operator.

Terminology: a **share** is a link bundling one or more files; **reverse share**
is a link that collects files instead of serving them; **egress** is total bytes
served by a share.

## Brand Commitments

The product is named **Borealis**. No logo, wordmark, or existing brand assets
have been supplied. No binding palette, typeface, or visual reference has been
specified by the owner.

## Evidence on Hand

No customers, testimonials, benchmarks, press, screenshots, or usage data exist.
The project is pre-release and self-hosted, so there are no hosted-service
claims, pricing, uptime figures, or user counts to cite. Future interface copy
must not invent any of these.

## Product Principles

1. **The recipient is a guest, not an intruder.** They arrive with no context;
   the public surface explains itself without requiring an account or docs.
2. **A leaked link must be survivable.** Every sharing affordance is paired with
   a way to bound its blast radius, and the operator can always see what happened.
3. **The operator owns the ceiling.** No artificial caps; limits are the ones the
   operator chose or the hardware imposes.
4. **Never claim more safety than is true.** Zero-knowledge, expiry, and caps
   mean specific things; the interface states plainly what is and is not protected.
5. **Unattended by default.** It must behave correctly for months without
   supervision, including cleaning up after expired shares.

## Accessibility & Inclusion

The owner has made these binding:

- Both light and dark themes are first-class.
- Keyboard operable and screen-reader accessible, targeting WCAG 2.1 AA: real
  focus indicators, accessible dialogs and menus, correct labelling, and status
  messages announced.
- Layouts must hold up on small screens; the share recipient in particular is
  likely to open the link on a phone.
