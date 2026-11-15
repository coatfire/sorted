import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const N = 16384;
const r = 8;
const p = 1;

function derive(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, { N, r, p }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function checkPassword(password: string, encoded: string) {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt" || parts[1] !== String(N)
    || parts[2] !== String(r) || parts[3] !== String(p)
    || !/^[a-f0-9]{32}$/.test(parts[4]) || !/^[a-f0-9]{128}$/.test(parts[5])) return false;
  const hash = await derive(password, Buffer.from(parts[4], "hex"));
  return timingSafeEqual(hash, Buffer.from(parts[5], "hex"));
}
