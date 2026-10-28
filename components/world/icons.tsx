import {
  Check,
  Clock,
  Download,
  FileText,
  Folder,
  Link2,
  Lock,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The interface's icon set, one stroke weight throughout. Decorative unless
 * given a `title`, in which case it is announced as an image with that name.
 */

type IconProps = { className?: string; title?: string };

function wrap(Icon: typeof Check) {
  return function WrappedIcon({ className, title }: IconProps) {
    return (
      <Icon
        className={cn("size-4", className)}
        strokeWidth={1.75}
        role={title ? "img" : undefined}
        aria-label={title}
        aria-hidden={title ? undefined : true}
      />
    );
  };
}

export const IconFile = wrap(FileText);
export const IconFolder = wrap(Folder);
export const IconUpload = wrap(Upload);
export const IconDownload = wrap(Download);
export const IconLock = wrap(Lock);
export const IconClock = wrap(Clock);
export const IconShare = wrap(Link2);
export const IconTrash = wrap(Trash2);
export const IconCheck = wrap(Check);
export const IconClose = wrap(X);
export const IconPlus = wrap(Plus);
