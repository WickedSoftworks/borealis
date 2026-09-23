"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseCidrList } from "@/lib/request";

const CHECKBOX =
  "size-3.5 shrink-0 appearance-none border border-ink-40 bg-transparent checked:bg-ink-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink-100";

export type ShareFormContext = {
  mailConfigured: boolean;
  addressesVisible: boolean;
};

/**
 * "Email me when this is downloaded", shared by the create and edit dialogs.
 *
 * The honest version of this control has to know whether mail can actually
 * leave the box. Without SMTP the message is written to the server log
 * instead — useful to an operator reading their logs, useless to someone
 * expecting an inbox — and the field says so rather than implying delivery.
 */
export function NotifyField({
  enabled,
  email,
  onEnabledChange,
  onEmailChange,
  accountEmail,
  mailConfigured,
}: {
  enabled: boolean;
  email: string;
  onEnabledChange: (next: boolean) => void;
  onEmailChange: (next: string) => void;
  accountEmail?: string;
  mailConfigured: boolean;
}) {
  const id = useId();

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2.5 text-[0.75rem] text-ink-60">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onEnabledChange(event.target.checked)}
          className={CHECKBOX}
        />
        Email me when a file is downloaded
      </label>

      {enabled && (
        <div className="flex flex-col gap-1.5 pl-6">
          <Label htmlFor={id}>Send to (blank for your account email)</Label>
          <Input
            id={id}
            type="email"
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            placeholder={accountEmail ?? "you@example.com"}
          />
          <p className="text-[0.6875rem] leading-relaxed text-ink-60">
            {mailConfigured
              ? "At most ten emails an hour per link; the access log keeps every download either way."
              : "This instance has no mail server configured, so notifications are written to the server log instead of being sent."}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * The address allow list, with its one sharp edge stated: on an instance that
 * trusts no proxy, no request carries an address the server can believe, and
 * an allow list then refuses everyone rather than guessing.
 */
export function AllowListField({
  value,
  onChange,
  addressesVisible,
}: {
  value: string;
  onChange: (next: string) => void;
  addressesVisible: boolean;
}) {
  const id = useId();
  const { invalid } = parseCidrList(value);

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Only open from these addresses (optional)</Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="203.0.113.7, 198.51.100.0/24"
        aria-invalid={invalid.length > 0}
        aria-describedby={`${id}-hint`}
        spellCheck={false}
        autoComplete="off"
      />
      <p
        id={`${id}-hint`}
        className="text-[0.6875rem] leading-relaxed text-ink-60"
      >
        {invalid.length > 0 ? (
          <span className="text-ink-100">
            Not an address or range: {invalid.join(", ")}
          </span>
        ) : !addressesVisible && value.trim() ? (
          <span className="text-ink-90">
            This instance trusts no proxy (TRUST_PROXY), so it cannot see
            recipients&apos; addresses — a list here would refuse everyone.
          </span>
        ) : (
          "Addresses or ranges, separated by commas. Blank lets anyone with the link in."
        )}
      </p>
    </div>
  );
}
