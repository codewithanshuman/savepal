import { redirect } from "next/navigation";
import Landing from "./landing";
import "./landing.css";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Older links (e.g. a PayPal seller return) pointed at "/?project=…"; send them to the workspace.
  const params = await searchParams;
  if (typeof params.project === "string") {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (typeof v === "string") next.set(k, v);
    redirect(`/app?${next.toString()}`);
  }
  return <Landing />;
}
