import type { Component, MessageBody } from "./types";
export const ids = { verify: "xplan:verify", credentials: "xplan:credentials", sync: "xplan:sync" };
export function buttons(...items: [string, string][]): unknown[] {
  return [{ type: 1, components: items.map(([custom_id, label]) => ({ type: 2, style: 1, custom_id, label })) }];
}
export function withSync(content: string): MessageBody { return { content, components: buttons([ids.sync, "更新身分組"], [ids.verify, "重新驗證"]) }; }
export function modal(v2 = false): unknown {
  return { type: 9, data: { custom_id: ids.credentials, title: "現有會員驗證", components: [
    ...(v2 ? [{ type: 18, label: "報名時填寫的交易所", component: { type: 3, custom_id: "exchange", required: true, min_values: 1, max_values: 1, options: [
      { label: "MEXC", value: "mexc" }, { label: "Bitget", value: "bitget" }, { label: "OKX", value: "okx" },
    ] } }] : []),
    { type: 18, label: "報名時填寫的 Exchange ID", component: { type: 4, custom_id: "exchange_id", style: 1, required: true, min_length: 1, max_length: 100, placeholder: "交易所 UID" } },
    { type: 18, label: "報名時填寫的 Email", component: { type: 4, custom_id: "email", style: 1, required: true, min_length: 3, max_length: 254, placeholder: "報名信箱" } },
  ] } };
}
export function field(components: Component[] | undefined, name: string): string {
  if (!Array.isArray(components)) return "";
  for (const c of components) {
    if (!c || typeof c !== "object") continue;
    if (c.custom_id === name && typeof c.value === "string") return c.value;
    if (c.custom_id === name && Array.isArray(c.values) && c.values.length === 1 && typeof c.values[0] === "string") return c.values[0];
    const nested = field(c.components || (c.component ? [c.component] : []), name);
    if (nested) return nested;
  }
  return "";
}
