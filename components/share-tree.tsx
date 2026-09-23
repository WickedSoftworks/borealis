import { FilePreview } from "@/components/file-preview";
import { EncryptedDownload } from "@/components/share-download";
import { Button } from "@/components/ui/button";
import { IconDownload, IconFile, IconFolder } from "@/components/world/icons";
import { StateTag } from "@/components/world/panel";
import { formatBytes } from "@/lib/format";
import { previewable } from "@/lib/preview";
import type {
  ShareContents,
  ShareFile,
  ShareFolder,
} from "@/lib/shares/contents";

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
};

function DownloadControl({
  file,
  token,
  viewOnly,
  exhausted,
}: RowProps & { file: ShareFile }) {
  if (file.scanStatus === "INFECTED") {
    // Said plainly and without the signature name: the recipient needs to
    // know the file is withheld and why, not what the scanner called it.
    return <StateTag tone="alarm">Withheld — flagged by scanner</StateTag>;
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
    <Button asChild variant="primary" size="sm">
      <a href={`/api/s/${token}/download/${file.id}`}>
        <IconDownload className="size-3.5" />
        Get
      </a>
    </Button>
  );
}

function FileRow({ file, ...rest }: RowProps & { file: ShareFile }) {
  const preview = file.scanStatus === "INFECTED" ? null : previewable(file);

  return (
    <li className="flex items-center gap-3 border-b border-dotted border-ink-20 px-3 py-2.5 last:border-b-0">
      {file.hasThumbnail && file.scanStatus !== "INFECTED" ? (
        // biome-ignore lint/performance/noImgElement: bytes from a guarded route, not an optimisable asset
        <img
          src={`/api/s/${rest.token}/thumbnail/${file.id}`}
          alt=""
          loading="lazy"
          className="size-10 shrink-0 border border-ink-20 object-cover"
        />
      ) : (
        <IconFile className="size-4 shrink-0 text-ink-60" />
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.8125rem] text-ink-80">
          {file.originalName}
        </p>
        <p className="flex items-center gap-2 text-[0.6875rem] tabular-nums text-ink-60">
          {formatBytes(Number(file.size))}
          {file.addedAfterShare && !file.isEncrypted && (
            <span className="uppercase tracking-[0.16em]">Added later</span>
          )}
        </p>
      </div>

      <span className="flex shrink-0 items-center gap-1.5">
        {preview && (
          <FilePreview
            url={`/api/s/${rest.token}/preview/${file.id}`}
            kind={preview.kind}
            name={file.originalName}
          >
            <Button
              variant="quiet"
              size="sm"
              aria-label={`View ${file.originalName}`}
            >
              View
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
    <li className="border-b border-dotted border-ink-20 last:border-b-0">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <IconFolder className="size-4 shrink-0 text-ink-60" />

        <p className="min-w-0 flex-1 truncate text-[0.8125rem] text-ink-90">
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
        <ul className="ml-3 border-l border-dotted border-ink-20 pl-3">
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
    <ul>
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
