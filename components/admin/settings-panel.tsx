"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorSlab, Notice } from "@/components/world/notice";
import { StateTag } from "@/components/world/panel";
import type { SettingView } from "@/lib/settings-snapshot";

type Field = {
  key: SettingView["key"];
  label: string;
  hint: string;
  placeholder?: string;
  type?: "text" | "password" | "number" | "email";
  /** Rendered as a select rather than a free field. */
  options?: Array<{ value: string; label: string }>;
};

const GROUPS: Array<{ title: string; fields: Field[] }> = [
  {
    title: "Instance",
    fields: [
      {
        key: "instance.name",
        label: "Name",
        hint: "Shown in the header, on share pages, and in email. The authenticator-app label is fixed at boot.",
        placeholder: "Borealis",
      },
    ],
  },
  {
    title: "Storage",
    fields: [
      {
        key: "storage.defaultQuota",
        label: "Per-account quota",
        hint: "For accounts without their own. Trash counts. Blank or “unlimited” for none.",
        placeholder: "none — e.g. 50GB",
      },
      {
        key: "storage.ceiling",
        label: "Instance ceiling",
        hint: "Everything on the instance together. New uploads are refused past it.",
        placeholder: "none — e.g. 2TB",
      },
      {
        key: "uploads.maxFileSize",
        label: "Largest single upload",
        hint: "Applies to collection links too.",
        placeholder: "none — e.g. 10GB",
      },
    ],
  },
  {
    title: "Records and access",
    fields: [
      {
        key: "audit.retentionDays",
        label: "Keep the access log for (days)",
        hint: "Older rows are removed by the hourly sweep. The operator audit log is kept regardless.",
        type: "number",
        placeholder: "30",
      },
      {
        key: "security.deniedIps",
        label: "Refused addresses",
        hint: "Addresses and ranges refused on every link and at sign-in, e.g. 192.0.2.0/24. Relies on TRUST_PROXY to see real addresses.",
        placeholder: "none — e.g. 192.0.2.0/24",
      },
    ],
  },
  {
    title: "Mail",
    fields: [
      {
        key: "mail.host",
        label: "SMTP host",
        hint: "",
        placeholder: "not set — e.g. smtp.example.com",
      },
      {
        key: "mail.port",
        label: "Port",
        hint: "465 is implicit TLS; 587 and 25 upgrade with STARTTLS.",
        type: "number",
        placeholder: "587",
      },
      {
        key: "mail.user",
        label: "Username",
        hint: "Blank for a relay that needs none.",
      },
      {
        key: "mail.password",
        label: "Password",
        hint: "Encrypted at rest with BETTER_AUTH_SECRET. Never shown again.",
        type: "password",
      },
      {
        key: "mail.from",
        label: "From",
        hint: "An address, or “Name <address>”.",
        placeholder: "not set — e.g. Files <files@example.com>",
      },
      {
        key: "mail.secure",
        label: "TLS",
        hint: "",
        options: [
          { value: "", label: "Decide from the port" },
          { value: "true", label: "Implicit TLS" },
          { value: "false", label: "STARTTLS or none" },
        ],
      },
    ],
  },
];

const SOURCE_LABEL = {
  database: "set here",
  environment: "from environment",
  default: "default",
} as const;

/**
 * Runtime settings, editable without a restart.
 *
 * Every field says where its current value comes from — this panel, the
 * environment, or the built-in default — because an operator who sets
 * something here and then wonders why their .env "stopped working" needs to
 * be able to see that the panel is winning. "Reset" hands a field back to the
 * environment.
 */
export function SettingsPanel({
  settings: initial,
  adminEmail,
}: {
  settings: SettingView[];
  adminEmail: string;
}) {
  const router = useRouter();
  const id = useId();
  const [settings, setSettings] = useState(initial);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testTo, setTestTo] = useState(adminEmail);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const byKey = new Map(settings.map((setting) => [setting.key, setting]));
  const dirty = Object.keys(draft).length > 0;

  async function save(patch: Record<string, string | null>) {
    setPending(true);
    setError(null);
    setNotice(null);
    setErrors({});

    const response = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = await response.json().catch(() => null);

    setPending(false);

    if (!response.ok) {
      setErrors(body?.fields ?? {});
      setError(body?.error ?? "Could not save.");
      return;
    }

    setSettings(body.settings);
    setDraft({});
    setNotice(
      body.changed.length > 0
        ? `Saved: ${body.changed.join(", ")}. In effect within a few seconds.`
        : "Nothing changed.",
    );
    router.refresh();
  }

  async function sendTest() {
    setTesting(true);
    setTestResult(null);

    const response = await fetch("/api/admin/settings/test-mail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: testTo }),
    });
    const body = await response.json().catch(() => null);

    setTesting(false);
    setTestResult(
      response.ok
        ? `Sent. The server said: ${body.response}`
        : `Not sent. ${body?.error ?? "The server refused."}`,
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        // "Decide from the port" is the absence of a TLS setting, not a value
        // of one, so choosing it hands the key back to the environment.
        void save(
          Object.fromEntries(
            Object.entries(draft).map(([key, value]) => [
              key,
              key === "mail.secure" && value === "" ? null : value,
            ]),
          ),
        );
      }}
      className="flex flex-col gap-6"
    >
      {GROUPS.map((group) => (
        <fieldset key={group.title} className="flex flex-col gap-3">
          <legend className="mb-1 text-[0.6875rem] uppercase tracking-[0.22em] text-ink-90">
            {group.title}
          </legend>

          <div className="grid gap-3 sm:grid-cols-2">
            {group.fields.map((field) => {
              const setting = byKey.get(field.key);
              if (!setting) return null;

              const fieldId = `${id}-${field.key}`;
              const value =
                draft[field.key] ??
                (setting.secret ? "" : (setting.value ?? ""));

              return (
                <div key={field.key} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <Label htmlFor={fieldId}>{field.label}</Label>
                    <span className="flex items-center gap-1.5">
                      <StateTag
                        tone={
                          setting.source === "database" ? "normal" : "quiet"
                        }
                      >
                        {setting.secret &&
                        setting.isSet &&
                        setting.source !== "database"
                          ? "set in environment"
                          : setting.secret && !setting.isSet
                            ? "not set"
                            : SOURCE_LABEL[setting.source]}
                      </StateTag>
                      {setting.source === "database" && (
                        <button
                          type="button"
                          className="text-[0.625rem] uppercase tracking-[0.16em] text-ink-60 underline underline-offset-2 hover:text-ink-100"
                          onClick={() => void save({ [field.key]: null })}
                          title={`Go back to ${setting.env} from the environment`}
                        >
                          Reset
                        </button>
                      )}
                    </span>
                  </div>

                  {field.options ? (
                    <select
                      id={fieldId}
                      value={value}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          [field.key]: event.target.value,
                        }))
                      }
                      className="h-9 border border-dotted border-ink-40 bg-ground px-2 font-mono text-[0.8125rem] text-ink-90 outline-none focus-visible:border-solid focus-visible:border-ink-100"
                    >
                      {field.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      id={fieldId}
                      type={field.type ?? "text"}
                      value={value}
                      placeholder={
                        setting.secret && setting.isSet
                          ? "•••••••• (unchanged)"
                          : field.placeholder
                      }
                      aria-invalid={Boolean(errors[field.key])}
                      autoComplete={setting.secret ? "new-password" : "off"}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          [field.key]: event.target.value,
                        }))
                      }
                    />
                  )}

                  <p className="text-[0.6875rem] leading-relaxed text-ink-60">
                    {errors[field.key] ? (
                      <span className="text-ink-100">{errors[field.key]}</span>
                    ) : (
                      <>
                        {field.hint}
                        {field.hint ? " " : ""}
                        <span className="text-ink-40">{setting.env}</span>
                      </>
                    )}
                  </p>
                </div>
              );
            })}
          </div>

          {group.title === "Mail" && (
            <div className="flex flex-col gap-1.5 border-t border-dotted border-ink-20 pt-3">
              <Label htmlFor={`${id}-test`}>Send a test message to</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id={`${id}-test`}
                  type="email"
                  value={testTo}
                  onChange={(event) => setTestTo(event.target.value)}
                  className="min-w-56 flex-1"
                />
                <Button
                  type="button"
                  variant="default"
                  disabled={testing || dirty || !testTo}
                  onClick={sendTest}
                >
                  {testing ? "Sending…" : "Send test"}
                </Button>
              </div>
              <p className="text-[0.6875rem] text-ink-60">
                {dirty
                  ? "Save first — the test uses the settings in effect."
                  : "Uses the settings in effect now, and reports what the server answered."}
              </p>
              <Notice>{testResult}</Notice>
            </div>
          )}
        </fieldset>
      ))}

      <ErrorSlab>{error}</ErrorSlab>
      <Notice>{notice}</Notice>

      <div className="flex justify-end gap-2">
        {dirty && (
          <Button type="button" variant="quiet" onClick={() => setDraft({})}>
            Discard changes
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={!dirty || pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
