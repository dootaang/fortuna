import { useEffect, useState } from "react";
import { TEXT, borrowDebt, fill, skillCost, type PlaceId } from "@fortuna/core";
import { paySkillInChat } from "@fortuna/data";
import { usePlayer } from "../session/player.tsx";
import { flash } from "../fx/effects.ts";
import { cue } from "../fx/cues.ts";
import { Coins, Modal, TextField, cx, useAction } from "../ui/kit.tsx";

/**
 * 장면에서 특기 쓰기: 특기 페이지와 같은 결제 장부로 코인을 내고, 결제 카드가 장소 채팅에 올라간다.
 * docs/SPEC-CITY-MAP.md 8-3절.
 */
export function SkillSheet({ open, onClose, prefill, place, sessionId, contestId }: {
  open: boolean;
  onClose: () => void;
  prefill: { skillId: string; usedLevel: number } | null;
  place: PlaceId;
  sessionId: string | null;
  contestId: string | null;
}) {
  const { player, config, wallet, session } = usePlayer();
  const { busy, run } = useAction();
  const skills = Object.entries(player.skills).sort((a, b) => a[1].name.localeCompare(b[1].name, "ko"));
  const [skillId, setSkillId] = useState(skills[0]?.[0] ?? "");
  const [used, setUsed] = useState(0);
  const [note, setNote] = useState("");
  const maxLevel = config.skill.cumulative.length - 1;

  useEffect(() => {
    if (!open) return;
    const id = prefill && player.skills[prefill.skillId] ? prefill.skillId : skillId || skills[0]?.[0] || "";
    setSkillId(id);
    const base = player.skills[id]?.level ?? 0;
    setUsed(Math.min(maxLevel, Math.max(base, prefill?.usedLevel ?? base)));
  }, [open]);

  const skill = player.skills[skillId];
  const level = skill ? Math.min(maxLevel, Math.max(skill.level, used)) : 0;
  const cost = skill ? skillCost(skill.level, level, config.skill.cumulative) : 0;
  const shortfall = Math.max(0, cost - wallet.balance);
  const canBorrow = config.borrow.enabled && shortfall > 0;

  async function pay() {
    if (!skill) return;
    const id = await run(() => paySkillInChat(session, player.name, place, { skillId, usedLevel: level, note, borrow: shortfall > 0 }, { sessionId, contestId }));
    if (!id) return;
    flash("gold", 360); cue("perfect");
    setNote("");
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="특기 쓰기">
      {!skills.length ? <p className="text-sm text-mist">{TEXT.skill.noSkills}</p> : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="특기">
            {skills.map(([id, entry]) => (
              <button key={id} type="button" role="radio" aria-checked={id === skillId}
                className={cx("btn btn-sm", id === skillId ? "btn-gold" : "btn-dark")}
                onClick={() => { cue("tap"); setSkillId(id); setUsed(entry.level); }}>{entry.name} {entry.level}점</button>
            ))}
          </div>
          {skill && (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-mist">쓸 점수</span>
                <div className="flex items-center gap-2">
                  <button type="button" className="btn btn-dark btn-sm w-9" aria-label="점수 내리기" disabled={level <= skill.level} onClick={() => setUsed(level - 1)}>−</button>
                  <span className="deco-title w-10 text-center text-3xl">{level}</span>
                  <button type="button" className="btn btn-dark btn-sm w-9" aria-label="점수 올리기" disabled={level >= maxLevel} onClick={() => setUsed(level + 1)}>+</button>
                </div>
              </div>
              <p className="text-right text-sm">결제 <Coins value={cost} /> <span className="text-mist">· 잔액 <Coins value={wallet.balance} /></span></p>
              <TextField label="장면에 남길 한 줄 (선택)" value={note} onChange={setNote} placeholder="검을 뽑아 든다" maxLength={200} />
              {contestId && <p className="text-xs text-gold-300">맞붙기 중입니다. 이 결제는 맞붙기 점수로 올라갑니다.</p>}
              {shortfall > 0 && <p className={cx("text-xs", canBorrow ? "text-gold-200" : "text-[#f2b3aa]")}>
                {canBorrow ? fill(TEXT.skill.borrowOffer, { amount: shortfall, debt: borrowDebt(shortfall, config.borrow.feeBps) }) : "잔액이 부족합니다."}
              </p>}
              <button type="button" className="btn btn-gold w-full" disabled={busy || (shortfall > 0 && !canBorrow)} onClick={() => void pay()}>
                {skill.name} {level}점 쓰기
              </button>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
