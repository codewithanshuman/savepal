import type { Metadata } from "next";
import { requireUser } from "../../auth";
import Realm from "./realm";
import "./realm.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "The Realm · SavePal" };

export default async function RealmPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const id = typeof params.id === "string" ? params.id : "";
  await requireUser(`/app/realm?id=${encodeURIComponent(id)}`);
  return <Realm id={id} />;
}
