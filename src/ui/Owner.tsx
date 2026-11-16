// Přiřazení cizího logu (počítače podle sériového čísla) buddymu.
import { ownLb, setComputerOwner, type GuestLog } from "../app/store";
import { Picker } from "./common";

export function OwnerPicker({ log, onDone }: { log: GuestLog; onDone?: () => void }) {
  const lb = ownLb();
  const buddies = Object.values(lb.buddies);
  // nejčastější buddy z mých ponorů
  const cnt = new Map<string, number>();
  for (const n of Object.values(lb.notes)) for (const b of n.buddyIds || []) cnt.set(b, (cnt.get(b) || 0) + 1);
  const top = [...cnt].sort((a, b) => b[1] - a[1]).map(([id]) => id).filter((id) => lb.buddies[id]).slice(0, 3);
  const done = async (b: { id?: string; name?: string }) => { await setComputerOwner(log, b); onDone?.(); };
  return (
    <div className="ownerbox">
      <b>Čí je to log? </b><small className="muted">{log.name} – zapamatuje se pro další logy z tohoto počítače</small>
      {top.length > 0 && <div className="quick">{top.map((id) => <button key={id} className="btn small" onClick={() => done({ id })}>{lb.buddies[id].name}</button>)}</div>}
      <Picker items={buddies.map((b) => ({ id: b.id, name: b.name }))} placeholder="Vyber buddyho nebo napiš jméno" onPick={(id) => done({ id })} onCreate={(name) => done({ name })} />
    </div>
  );
}
