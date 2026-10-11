import { useState } from "react";
import { Modal, Toggle } from "../ui/kit.tsx";
import { prefersReducedMotion, setFxSettings, useFxSettings } from "./settings.ts";
import { cue } from "./cues.ts";

const canVibrate = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

/** ⚙ in the header: sound, vibration, faster staging. Saved on this device only. */
export function FxSettingsButton() {
  const [open, setOpen] = useState(false);
  const settings = useFxSettings();
  return (
    <>
      <button type="button" className="grid h-9 w-9 place-items-center rounded-full border border-gold-400/40 text-gold-200 transition hover:bg-gold-400/10" aria-label="연출 설정" onClick={() => setOpen(true)}>⚙</button>
      <Modal open={open} onClose={() => setOpen(false)} title="연출 설정">
        <Toggle label="효과음" checked={settings.sound} onChange={(sound) => { setFxSettings({ sound }); if (sound) cue("chip"); }} />
        <Toggle label="진동" hint={canVibrate ? "안드로이드에서 동작합니다." : "이 기기의 브라우저는 진동을 지원하지 않습니다(아이폰 사파리 등)."} checked={settings.haptics && canVibrate} onChange={(haptics) => { setFxSettings({ haptics }); if (haptics) cue("win"); }} />
        <Toggle label="연출 빠르게" hint="도박 연출과 공개 시간을 절반으로 줄입니다." checked={settings.fast} onChange={(fast) => setFxSettings({ fast })} />
        {prefersReducedMotion() && <p className="mt-2 text-xs text-mist">기기의 "동작 줄이기" 설정이 켜져 있어 흔들림과 꽃가루는 꺼져 있습니다.</p>}
        <p className="mt-3 text-xs text-mist">이 설정은 이 기기에만 저장되며 게임 결과에는 영향이 없습니다.</p>
      </Modal>
    </>
  );
}
