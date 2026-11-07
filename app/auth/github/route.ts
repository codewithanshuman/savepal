import { startSignIn } from "../../auth-handlers";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return startSignIn(request, "github");
}
