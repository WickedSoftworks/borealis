/**
 * The allowed values of every enum-ish column.
 *
 * The schema stores these as plain strings because SQLite has no enums and the
 * models must generate identically for both providers
 * (`prisma/schema/models.prisma`). That makes this file the only place the sets
 * are written down, so a new value is added here first and used from here —
 * a bare string literal in a route is a value nothing checks.
 */

export const SHARE_TYPES = ["SEND", "REVERSE"] as const;
export type ShareType = (typeof SHARE_TYPES)[number];

/** `ShareAccess.action` — what a recipient did. */
export const ACCESS_ACTIONS = [
  "VIEW",
  "DOWNLOAD",
  "UNLOCK_FAIL",
  "UPLOAD",
  /** Refused before the guard ran: an IP outside the link's allow list. */
  "DENIED",
] as const;
export type AccessAction = (typeof ACCESS_ACTIONS)[number];

export const JOB_TYPES = [
  "EXTRACT_TEXT",
  "CHECKSUM",
  "EXPIRE_SWEEP",
  "NOTIFY_DOWNLOAD",
  "PURGE_FILE",
  "THUMBNAIL",
  "SCAN_FILE",
  "RECONCILE_STORAGE",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ["PENDING", "RUNNING", "DONE", "FAILED"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const FILE_TEXT_STATUSES = [
  "PENDING",
  "DONE",
  "FAILED",
  "SKIPPED",
] as const;
export type FileTextStatus = (typeof FILE_TEXT_STATUSES)[number];

export const SCAN_STATUSES = [
  "CLEAN",
  "INFECTED",
  "SKIPPED",
  "FAILED",
] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

/** `AuditEvent.action` — what an operator did. */
export const AUDIT_ACTIONS = [
  "USER_BAN",
  "USER_UNBAN",
  "USER_ROLE",
  "USER_QUOTA",
  "USER_DELETE",
  "FILE_DELETE_OTHER",
  "SETTING_CHANGE",
  "JOB_RETRY",
  "JOB_DISCARD",
  "MAIL_TEST",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_TARGETS = [
  "user",
  "file",
  "setting",
  "job",
  "instance",
] as const;
export type AuditTarget = (typeof AUDIT_TARGETS)[number];
