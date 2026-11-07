import { finishSignIn } from "../../../auth-handlers";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return finishSignIn(request, "google");
}
