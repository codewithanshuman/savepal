import { requireChatGPTUser } from "../chatgpt-auth";
import Workspace from "../workspace";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  await requireChatGPTUser("/app");
  return <Workspace />;
}
