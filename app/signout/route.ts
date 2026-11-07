import { signOut } from "../auth-handlers";

export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return signOut(request);
}
