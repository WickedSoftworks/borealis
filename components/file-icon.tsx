import {
  File,
  FileArchive,
  FileText,
  Film,
  Image,
  KeyRound,
  Music,
} from "lucide-react";
import { type FileKind, fileKind } from "@/lib/file-kind";
import { cn } from "@/lib/utils";

const ICONS: Record<FileKind, typeof File> = {
  document: FileText,
  text: FileText,
  image: Image,
  video: Film,
  audio: Music,
  archive: FileArchive,
  other: File,
};

/**
 * A file's kind as a small tile. End-to-end encrypted files get the key in
 * the encryption colour instead: the server cannot see past that, so neither
 * does the icon.
 */
export function FileIcon({
  mimeType,
  encrypted = false,
  className,
}: {
  mimeType: string;
  encrypted?: boolean;
  className?: string;
}) {
  const Icon = encrypted ? KeyRound : ICONS[fileKind(mimeType)];

  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-md",
        encrypted ? "bg-e2e-soft text-e2e" : "bg-raised text-fg-subtle",
        className,
      )}
    >
      <Icon className="size-[18px]" strokeWidth={1.6} />
    </span>
  );
}
