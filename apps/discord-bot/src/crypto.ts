const encoder = new TextEncoder();
export function fromHex(value: string): Uint8Array {
  if (!/^(?:[a-f0-9]{2})+$/i.test(value)) throw new Error("Invalid hexadecimal input");
  return Uint8Array.from(value.match(/../g)!, (byte) => parseInt(byte, 16));
}
export function toHex(value: ArrayBuffer): string { return [...new Uint8Array(value)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
export async function digest(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}
export function sameDigest(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
export async function verifyDiscordSignature(body: string, signature: string, timestamp: string, publicKey: string, now = Date.now()): Promise<boolean> {
  if (!/^\d{10}$/.test(timestamp) || Math.abs(now - Number(timestamp) * 1000) > 5 * 60_000 || !/^[a-f0-9]{128}$/i.test(signature)) return false;
  try {
    const key = await crypto.subtle.importKey("raw", fromHex(publicKey), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, fromHex(signature), encoder.encode(timestamp + body));
  } catch { return false; }
}
