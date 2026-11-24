// Zobrazení plynů: název (AIR místo staršího „vzduch“) a barva podle druhu plynu (stejná jako v grafech).
import { tankMix } from "./model";
import { GAS_COLOR, gasLabel } from "../core/analysis";

/** Název plynu pro zobrazení; starší uložené „vzduch“ → AIR. */
export const gasDisp = (g: string) => (/^\s*vzduch\s*$/i.test(g) ? "AIR" : g);
/** Barva plynu podle názvu nebo směsi (AIR, NX, TMX, O₂, argon); null = neznámý. */
export function gasColorOf(g: string): string | null {
  if (/^\s*argon\s*$/i.test(g)) return GAS_COLOR.ar;
  const m = tankMix(g) ?? (/^\d+\/\d+$/.test(g) ? g : null);
  return m ? GAS_COLOR[gasLabel(m).cls] : null;
}
