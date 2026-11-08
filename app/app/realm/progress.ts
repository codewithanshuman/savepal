/* Town progress: the Realm grows from real work. Every reward below comes from a real state change
 * in an agreement (sworn terms, a PayPal hold, a delivery, an approval, a PayPal payment, a bounty,
 * a settled appeal), so the town level is a record of what you've actually done with SavePal. */

export type RewardPlace = "castle" | "treasury" | "guild" | "market" | "harbour";
export type Reward = { key: string; projectId: string; label: string; xp: number; place: RewardPlace };

type P = {
  id: string; title: string; status: string; payment_status: string; amount_cents: number; evidence_url: string | null;
  funding: { mode: string; status: string };
  realm?: { bounties: Array<{ id: string; amount_cents: number; status: string }>; appeals: Array<{ id: string; status: string }> };
};

const PAID = ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"];
export const isPaid = (p: P) => p.funding.status === "CAPTURED" || PAID.includes(p.payment_status);

/** Every reward earned so far, across all agreements. */
export function rewards(projects: P[]): Reward[] {
  const out: Reward[] = [];
  for (const p of projects) {
    const paid = isPaid(p), add = (k: string, label: string, xp: number, place: RewardPlace) => out.push({ key: `${p.id}:${k}`, projectId: p.id, label, xp, place });
    if (p.status !== "INVITED") add("sworn", "Terms sworn", 30, "castle");
    if (["HELD", "PENDING", "CAPTURED"].includes(p.funding.status)) add("held", "Gold locked", 50, "treasury");
    if (p.evidence_url) add("delivered", "Work delivered", 40, "guild");
    if (p.status === "APPROVED" || paid) add("approved", "Decree sealed", 60, "castle");
    if (paid) add("paid", "Paid by PayPal", 100 + Math.min(400, Math.floor(p.amount_cents / 1000)), "treasury");
    for (const b of p.realm?.bounties ?? []) if (b.status === "COMPLETED") out.push({ key: `bounty:${b.id}`, projectId: p.id, label: "Bounty paid", xp: 25 + Math.min(200, Math.floor(b.amount_cents / 200)), place: "market" });
    for (const a of p.realm?.appeals ?? []) if (a.status === "REFUNDED" || a.status === "DECLINED") out.push({ key: `appeal:${a.id}`, projectId: p.id, label: "Appeal settled", xp: 20, place: "harbour" });
  }
  return out;
}

/** Level n needs 100·n(n−1)/2 XP: 0, 100, 300, 600, 1000… */
export function levelFor(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  while (xp >= 50 * (level + 1) * level) level++;
  const floor = 50 * level * (level - 1), next = 50 * (level + 1) * level;
  return { level, into: xp - floor, need: next - floor };
}

/** Houses standing in the town: it starts as a hamlet and fills its blocks as you level up. */
export const housesBuilt = (level: number, total: number) => Math.min(total, 40 + level * 6);

/** What a level unlocks, shown on the level-up banner. */
export const UNLOCKS: Record<number, string> = {
  2: "Six new homes rise in the quarter",
  3: "The west district opens for building",
  4: "A new street of homes by the farms",
  5: "The town becomes a city",
};
