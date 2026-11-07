import { requireUser } from "../auth";
import Workspace from "../workspace";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  await requireUser("/app");
  return <Workspace />;
}
