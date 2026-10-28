import { redirect } from "next/navigation";

/**
 * "Send files" from the header. Until the one-step composer exists this lands
 * on the upload area of the vault, where files are uploaded and then shared.
 */
export default function SendPage() {
  redirect("/dashboard#upload");
}
