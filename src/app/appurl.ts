// Adresa aplikace (produkce) pro sdílení, QR a sdílené srovnání. Bez natvrdo zapsané domény:
// přednost má window.MYX_APP_URL z public/config.js, jinak se odvodí z aktuální adresy (bez /dev/).
declare global { interface Window { MYX_APP_URL?: string } }
export function appUrl(): string {
  if (typeof window !== "undefined" && window.MYX_APP_URL) return window.MYX_APP_URL.replace(/\/?$/, "/");
  if (typeof location === "undefined") return "";
  return location.origin + location.pathname.replace(/\/dev(\/.*)?$/, "/").replace(/[^/]*$/, "");
}
