import { Eye } from "lucide-react";
import { FileIcon } from "@/components/file-icon";
import { FilePreview } from "@/components/file-preview";
import { EncryptedDownload } from "@/components/share-download";
import { Button } from "@/components/ui/button";
import { IconDownload, IconFolder } from "@/components/world/icons";
import { StateTag } from "@/components/world/panel";
import { fileKindLabel } from "@/lib/file-kind";
import { formatBytes } from "@/lib/format";
import { previewable } from "@/lib/preview";
import type {
  ShareContents,
  ShareFile,
  ShareFolder,
} from "@/lib/shares/contents";
import { withheldReason } from "@/lib/shares/withheld";

/**
 * What the recipient sees inside a share.
 *
 * Folder structure is preserved rather than flattened: someone handed forty
 * files arranged in six folders was handed an arrangement, and throwing it away
 * at the door makes the delivery harder to read than the original.
 *
 * Nesting is drawn with an indent and a rule rather than with disclosure
 * triangles. Everything here is already permitted — collapsing it would hide
 * what the link contains behind a click, and the whole point of this page is to
 * state that plainly.
 *
 * Each row offers what the link allows, independently: "View" whenever the
 * file can be shown inline (lib/preview.ts decides), and then the download
 * control — or the reason there is none. `viewOnly` removes the second, not
 * the first; that is what "preview only" means.
 */

type RowProps = {
  token: string;
  viewOnly: boolean;
  exhausted: boolean;
  /** Whether a malware scanner is configured; see lib/shares/withheld.ts. */
  scanning: boolean;
};

function DownloadControl({
  file,
  token,
  viewOnly,
  exhausted,
  scanning,
}: RowProps & { file: ShareFile }) {
  const withheld = withheldReason(file, scanning);

  if (withheld === "INFECTED") {
    // Said plainly and without the signature name: the recipient needs to
    // know the file is withheld and why, not what the scanner called it.
    return <StateTag tone="alarm">Withheld — flagged by scanner</StateTag>;
  }

  if (withheld === "UNSCANNED") {
    // Usually a fresh upload, seconds from its verdict. Not an error.
    return <StateTag tone="quiet">Being checked — try again shortly</StateTag>;
  }

  if (viewOnly) return <StateTag tone="quiet">View only</StateTag>;
  if (exhausted) return <StateTag tone="alarm">No downloads left</StateTag>;

  if (file.isEncrypted && file.addedAfterShare) {
    /*
      This file was uploaded into a shared folder after the link was made,
      so its key was never in the link's fragment and never can be. Saying
      that plainly matters: the generic "key missing" state means the link
      arrived cut short, and letting this case borrow that message would
      teach recipients to ignore the one warning that means a real problem.
    */
    return <StateTag tone="quiet">Added later — no key</StateTag>;
  }

  if (file.isEncrypted) {
    return (
      <EncryptedDownload
        token={token}
        fileId={file.id}
        filename={file.originalName}
        mimeType={file.mimeType}
      />
    );
  }

  return (
    <Button
      asChild
      variant="default"
      size="icon"
      aria-label={`Download ${file.originalName}`}
    >
      <a href={`/api/s/${token}/download/${file.id}`}>
        <IconDownload className="size-4" />
      </a>
    </Button>
  );
}

function FileRow({ file, ...rest }: RowProps & { file: ShareFile }) {
  const servable = withheldReason(file, rest.scanning) === null;
  const preview = servable ? previewable(file) : null;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line py-3">
      {file.hasThumbnail && servable ? (
        // biome-ignore lint/performance/noImgElement: bytes from a guarded route, not an optimisable asset
        <img
          src={`/api/s/${rest.token}/thumbnail/${file.id}`}
          alt=""
          loading="lazy"
          className="size-10 shrink-0 rounded-lg object-cover outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
        />
      ) : (
        <FileIcon
          mimeType={file.mimeType}
          encrypted={file.isEncrypted}
          className="size-10"
        />
      )}

      <div className="flex min-w-0 flex-[1_1_160px] flex-col gap-0.5">
        <p className="break-words text-sm font-medium text-fg">
          {file.originalName}
        </p>
        <p className="data text-fg-subtle">
          {[
            fileKindLabel(file.mimeType, file.originalName),
            formatBytes(Number(file.size)),
            file.isEncrypted && "encrypted",
            file.addedAfterShare && !file.isEncrypted && "added later",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {preview && (
          <FilePreview
            url={`/api/s/${rest.token}/preview/${file.id}`}
            kind={preview.kind}
            name={file.originalName}
          >
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Preview ${file.originalName}`}
            >
              <Eye aria-hidden="true" className="size-4" strokeWidth={1.75} />
            </Button>
          </FilePreview>
        )}

        <DownloadControl file={file} {...rest} />
      </span>
    </li>
  );
}

function FolderBranch({ folder, ...rest }: RowProps & { folder: ShareFolder }) {
  const isEmpty = folder.files.length === 0 && folder.folders.length === 0;

  return (
    <li className="border-t border-line">
      <div className="flex items-center gap-3 py-3">
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-lg bg-raised text-fg-subtle"
        >
          <IconFolder className="size-[18px]" />
        </span>

        <p className="min-w-0 flex-1 break-words text-sm font-medium text-fg">
          {folder.name}
        </p>

        {/*
          An empty folder is shown rather than dropped. The sender put it in the
          link; a recipient who was told about it and cannot find it will assume
          the link is broken.
        */}
        {isEmpty && <StateTag tone="quiet">Empty</StateTag>}
      </div>

      {!isEmpty && (
        <ul className="ml-5 border-l border-line pl-4">
          {folder.folders.map((child) => (
            <FolderBranch key={child.id} folder={child} {...rest} />
          ))}
          {folder.files.map((file) => (
            <FileRow key={file.id} file={file} {...rest} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function ShareTree({
  contents,
  ...rest
}: RowProps & { contents: ShareContents }) {
  return (
    <ul className="border-b border-line">
      {/* Folders first, then loose files — the shape of the thing before its
          contents, which is the order every file manager has taught. */}
      {contents.folders.map((folder) => (
        <FolderBranch key={folder.id} folder={folder} {...rest} />
      ))}
      {contents.files.map((file) => (
        <FileRow key={file.id} file={file} {...rest} />
      ))}
    </ul>
  );
}
