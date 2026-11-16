import type { Client } from "@sorted/core";

const plain = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** "grainne" finds Gráinne, and digits find a number however it was typed: 087…, 00353 87… or +353 87…. */
export function searchClients<T extends Pick<Client, "name" | "phone" | "email">>(clients: T[], query: string): T[] {
  const text = plain(query.trim()), digits = query.replace(/\D/g, "").replace(/^0+/, "");
  if (!text) return clients;
  return clients.filter((client) => plain(client.name).includes(text) || (client.email ?? "").toLowerCase().includes(text)
    || (digits.length >= 3 && (client.phone ?? "").replace(/\D/g, "").includes(digits)));
}
