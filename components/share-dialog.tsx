"use client";

import { useState } from "react";
import { ShareComposer } from "@/components/share-composer";
import type { ShareFormContext } from "@/components/share-fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/world/dialog";
import { IconShare } from "@/components/world/icons";
import { describeItems } from "@/lib/shares/composer";

/**
 * Share what is selected in the vault. The composer does the work; this is
 * the dialog around it, wide while the rules are being set and narrow once
 * there is only a link to copy.
 */
export function ShareDialog({
  fileIds,
  folderIds = [],
  encryptedFileIds = [],
  disabled,
  context,
  children,
}: {
  fileIds: string[];
  folderIds?: string[];
  encryptedFileIds?: string[];
  disabled?: boolean;
  /** Whether mail leaves the box and addresses can be seen; see share-fields. */
  context: ShareFormContext;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState(false);
  // Bumped to start the composer over with every field cleared.
  const [round, setRound] = useState(0);

  function again() {
    setCreated(false);
    setRound((current) => current + 1);
  }

  const items = describeItems(fileIds.length, folderIds.length);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) again();
      }}
    >
      <DialogTrigger asChild>
        {children ?? (
          <Button variant="primary" disabled={disabled}>
            <IconShare className="size-3.5" />
            Share
          </Button>
        )}
      </DialogTrigger>

      <DialogContent
        title={created ? "Your link is ready" : "Share"}
        description={
          created
            ? undefined
            : `Make a link to ${items}. Set when it stops working before you send it.`
        }
        className={created ? "max-w-xl" : "max-w-[1000px]"}
      >
        <ShareComposer
          key={round}
          fileIds={fileIds}
          folderIds={folderIds}
          encryptedFileIds={encryptedFileIds}
          context={context}
          onCancel={() => setOpen(false)}
          onCreated={() => setCreated(true)}
          onAgain={again}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
