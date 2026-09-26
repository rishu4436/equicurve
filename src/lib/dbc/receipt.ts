/** Launch receipt model (pure). Each item carries an explicit trust state. */
export type ReceiptState = "confirmed" | "pending" | "estimate" | "failed" | "local";

export type ReceiptItem = {
  key: string;
  label: string;
  value: string;
  kind: "address" | "tx" | "text";
  state: ReceiptState;
  note?: string;
};

export type LaunchReceipt = {
  cluster: string;
  items: ReceiptItem[];
};

export function upsertReceiptItem(r: LaunchReceipt, item: ReceiptItem): LaunchReceipt {
  const i = r.items.findIndex((x) => x.key === item.key);
  const items = [...r.items];
  if (i >= 0) items[i] = { ...items[i], ...item };
  else items.push(item);
  return { ...r, items };
}

export function setReceiptState(r: LaunchReceipt, key: string, state: ReceiptState, note?: string): LaunchReceipt {
  return {
    ...r,
    items: r.items.map((x) => (x.key === key ? { ...x, state, ...(note !== undefined ? { note } : {}) } : x)),
  };
}

export const RECEIPT_STATE_LABEL: Record<ReceiptState, string> = {
  confirmed: "confirmed",
  pending: "pending",
  estimate: "estimate",
  failed: "failed",
  local: "local only",
};
