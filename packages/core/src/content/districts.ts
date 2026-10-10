import type { WorkSkins } from "../work/types.ts";

/**
 * 도시구역 정의. 이름·간부·일 게임 겉모습은 여기서 고친다.
 * 해방 여부와 공제율 같은 상태값은 Firestore districts/{id}에 있다.
 * 새 구역을 추가하면 관리자 화면 › 구역에서 "구역 동기화"를 누른다.
 */
export interface DistrictContent {
  id: string;
  name: string;
  /** 간부가 없는 구역(도심)은 false. */
  hasOfficer: boolean;
  officerTitle: string;
  blurb: string;
  emblem: string;
  /** Accent used on cards and headers. */
  accent: string;
  work: WorkSkins;
}


export const DISTRICTS: readonly DistrictContent[] = [
  {
    id: "modern", name: "현대판타지", hasOfficer: true, officerTitle: "현대판타지 구역 간부", emblem: "🏙️", accent: "#7fb7d9",
    blurb: "네온 간판 아래 헌터 길드와 편의점이 나란히 불을 켜는 구역.",
    work: {
      sort: {
        title: "길드 의뢰서 분류", intro: "밤새 쌓인 의뢰서를 창구별로 나눠 꽂으세요.", icon: "📜",
        bins: [{ id: "hunt", label: "토벌", icon: "⚔️" }, { id: "gather", label: "채집", icon: "🌿" }, { id: "escort", label: "호위", icon: "🛡️" }],
        items: [
          { label: "고블린 둥지 소탕", icon: "👺", bin: "hunt" }, { label: "D급 게이트 정리", icon: "🌀", bin: "hunt" }, { label: "지하철 슬라임 제거", icon: "🟢", bin: "hunt" }, { label: "오크 무리 처치", icon: "🐗", bin: "hunt" },
          { label: "마정석 회수", icon: "💎", bin: "gather" }, { label: "월광초 채취", icon: "🌙", bin: "gather" }, { label: "던전 버섯 수거", icon: "🍄", bin: "gather" }, { label: "마수 가죽 수집", icon: "🧶", bin: "gather" },
          { label: "아이돌 경호", icon: "🎤", bin: "escort" }, { label: "수송 트럭 동행", icon: "🚚", bin: "escort" }, { label: "신입 헌터 인솔", icon: "🧑‍🎓", bin: "escort" }, { label: "VIP 귀가 동행", icon: "🕴️", bin: "escort" },
        ],
      },
      memory: {
        title: "헌터 장비 대여", intro: "헌터가 불러 준 장비를 기억했다가 그대로 내주세요.", icon: "🗡️", noun: "대여 목록",
        items: [{ label: "장검", icon: "🗡️" }, { label: "방패", icon: "🛡️" }, { label: "회복 물약", icon: "🧪" }, { label: "마나 물약", icon: "🔮" }, { label: "손전등", icon: "🔦" }, { label: "로프", icon: "🪢" }, { label: "활", icon: "🏹" }, { label: "통신기", icon: "📻" }, { label: "구급상자", icon: "🩹" }, { label: "지도", icon: "🗺️" }, { label: "부적 카드", icon: "🃏" }, { label: "에너지바", icon: "🍫" }],
      },
      math: {
        title: "편의점 계산", intro: "새벽 손님이 몰렸습니다. 거스름돈을 틀리지 마세요.", icon: "🏪", unit: "코인",
        add: ["삼각김밥 {a} + 음료 {b}", "컵라면 {a} + 물약 {b}"], sub: ["{a} 받고 {b}짜리 계산하면 거스름돈은?", "포인트 {a}에서 {b} 사용"], mul: ["{b}코인 에너지바 {a}개", "{a}코인 컵라면 {b}개"],
      },
      timing: { title: "게이트 봉인 도장", intro: "게이트가 닫히는 순간에 봉인 도장을 찍으세요.", icon: "🌀", action: "봉인", hit: "봉인 완료", miss: "틈이 남았다" },
    },
  },
  {
    id: "medieval", name: "중세판타지", hasOfficer: true, officerTitle: "중세판타지 구역 간부", emblem: "🏰", accent: "#c9a46b",
    blurb: "성벽과 대장간 연기, 약초 냄새가 섞인 돌길의 구역.",
    work: {
      sort: {
        title: "약초 감별", intro: "약초상에 들어온 풀을 약초와 독초로 가르세요.", icon: "🌿",
        bins: [{ id: "herb", label: "약초", icon: "🌱" }, { id: "poison", label: "독초", icon: "☠️" }],
        items: [
          { label: "은빛 세이지", icon: "🌿", bin: "herb" }, { label: "용의 혀 이끼", icon: "🍀", bin: "herb" }, { label: "새벽이슬 꽃", icon: "🌼", bin: "herb" }, { label: "치유 뿌리", icon: "🥕", bin: "herb" }, { label: "달맞이 잎", icon: "🍃", bin: "herb" },
          { label: "까마귀 버섯", icon: "🍄", bin: "poison" }, { label: "검은 벨라돈나", icon: "🫐", bin: "poison" }, { label: "늑대 덩굴", icon: "🥀", bin: "poison" }, { label: "마녀 손톱풀", icon: "🌵", bin: "poison" }, { label: "잿빛 독미나리", icon: "🌾", bin: "poison" },
        ],
      },
      memory: {
        title: "여관 주문 받기", intro: "모험가 일행의 주문을 기억해 쟁반에 올리세요.", icon: "🍺", noun: "주문",
        items: [{ label: "에일", icon: "🍺" }, { label: "스튜", icon: "🍲" }, { label: "흑빵", icon: "🍞" }, { label: "구운 닭", icon: "🍗" }, { label: "치즈", icon: "🧀" }, { label: "사과", icon: "🍎" }, { label: "포도주", icon: "🍷" }, { label: "꿀술", icon: "🍯" }, { label: "소시지", icon: "🌭" }, { label: "버섯 파이", icon: "🥧" }, { label: "생선 구이", icon: "🐟" }, { label: "우유", icon: "🥛" }],
      },
      math: {
        title: "상단 장부 셈", intro: "상단 마차가 출발하기 전에 장부를 맞추세요.", icon: "📒", unit: "코인",
        add: ["밀 {a}포대 값에 소금 {b}", "편자 {a}에 마구 {b}"], sub: ["금고 {a}에서 통행세 {b}", "선금 {a} 중 {b} 지출"], mul: ["말 {a}마리 × 사료 {b}", "{a}코인 화살 {b}다발"],
      },
      timing: { title: "대장간 망치질", intro: "쇠가 가장 붉을 때 망치를 내려치세요.", icon: "🔨", action: "망치질", hit: "쨍!", miss: "헛손질" },
    },
  },
  {
    id: "wuxia", name: "무협", hasOfficer: true, officerTitle: "무협 구역 간부", emblem: "🏯", accent: "#d97a5b",
    blurb: "객잔의 등불과 표국 깃발이 휘날리는, 강호의 규칙이 남은 구역.",
    work: {
      sort: {
        title: "표국 배달 분류", intro: "오늘 실을 화물을 성문별 수레에 나눠 실으세요.", icon: "📦",
        bins: [{ id: "east", label: "동문", icon: "🌅" }, { id: "west", label: "서문", icon: "🌇" }, { id: "south", label: "남문", icon: "⛰️" }],
        items: [
          { label: "동문 비단 상자", icon: "🧵", bin: "east" }, { label: "동문 찻잎 꾸러미", icon: "🍵", bin: "east" }, { label: "동문 서신", icon: "✉️", bin: "east" }, { label: "동문 약재", icon: "🌿", bin: "east" },
          { label: "서문 은자 궤짝", icon: "💰", bin: "west" }, { label: "서문 검 한 자루", icon: "🗡️", bin: "west" }, { label: "서문 도자기", icon: "🏺", bin: "west" }, { label: "서문 비급 두루마리", icon: "📜", bin: "west" },
          { label: "남문 쌀가마", icon: "🌾", bin: "south" }, { label: "남문 술독", icon: "🍶", bin: "south" }, { label: "남문 부채", icon: "🪭", bin: "south" }, { label: "남문 등롱", icon: "🏮", bin: "south" },
        ],
      },
      memory: {
        title: "객잔 서빙", intro: "협객들이 시킨 요리를 기억해 상을 차리세요.", icon: "🥢", noun: "주문",
        items: [{ label: "만두", icon: "🥟" }, { label: "소면", icon: "🍜" }, { label: "죽엽청", icon: "🍶" }, { label: "오리구이", icon: "🦆" }, { label: "흰쌀밥", icon: "🍚" }, { label: "용정차", icon: "🍵" }, { label: "월병", icon: "🥮" }, { label: "새우찜", icon: "🦐" }, { label: "두부", icon: "🧈" }, { label: "죽", icon: "🥣" }, { label: "탕후루", icon: "🍡" }, { label: "생선찜", icon: "🐟" }],
      },
      math: {
        title: "전장 은자 셈", intro: "전장(錢莊) 창구에서 은자를 세어 내주세요.", icon: "🪙", unit: "냥",
        add: ["은자 {a}냥에 이자 {b}냥", "표행비 {a}냥 + 숙박 {b}냥"], sub: ["예치 {a}냥에서 {b}냥 인출", "{a}냥 받고 {b}냥짜리 계산"], mul: ["하루 {a}냥 × {b}일 숙박", "말 {a}필 × {b}냥"],
      },
      timing: { title: "약탕 불 조절", intro: "탕약이 끓어오르는 순간에 불을 줄이세요.", icon: "🔥", action: "불 조절", hit: "약효가 살았다", miss: "탕약이 넘쳤다" },
    },
  },
  {
    id: "cyberpunk", name: "사이버펑크", hasOfficer: true, officerTitle: "사이버펑크 구역 간부", emblem: "🌃", accent: "#d35fd1",
    blurb: "비에 젖은 홀로그램과 불법 개조 의원이 공존하는 구역.",
    work: {
      sort: {
        title: "칩 검수", intro: "컨베이어 위 칩을 정품·불량·위조로 가르세요.", icon: "💾",
        bins: [{ id: "ok", label: "정품", icon: "✅" }, { id: "bad", label: "불량", icon: "⚠️" }, { id: "fake", label: "위조", icon: "🕵️" }],
        items: [
          { label: "봉인 정상 메모리칩", icon: "💾", bin: "ok" }, { label: "인증 각인 의체칩", icon: "🦾", bin: "ok" }, { label: "정품 신경칩", icon: "🧠", bin: "ok" }, { label: "공장 출하 배터리", icon: "🔋", bin: "ok" },
          { label: "핀 휜 칩", icon: "📌", bin: "bad" }, { label: "탄 자국 칩", icon: "🔥", bin: "bad" }, { label: "금 간 렌즈", icon: "🔍", bin: "bad" }, { label: "누액 배터리", icon: "💧", bin: "bad" },
          { label: "각인 번진 칩", icon: "🖨️", bin: "fake" }, { label: "가짜 홀로그램 씰", icon: "🪪", bin: "fake" }, { label: "무게 다른 칩", icon: "⚖️", bin: "fake" }, { label: "출처 불명 펌웨어", icon: "👾", bin: "fake" },
        ],
      },
      memory: {
        title: "데이터 택배", intro: "의뢰인이 불러 준 주소를 외워 드론에 입력하세요.", icon: "📡", noun: "배송지",
        items: [{ label: "네온 7번가", icon: "🌆" }, { label: "라면 노점", icon: "🍜" }, { label: "의체 클리닉", icon: "🦿" }, { label: "지하 클럽", icon: "🎧" }, { label: "기업 타워", icon: "🏢" }, { label: "폐차장", icon: "🚗" }, { label: "빗물 정수장", icon: "🚰" }, { label: "넷카페", icon: "💻" }, { label: "전당포", icon: "🏷️" }, { label: "옥상 정원", icon: "🪴" }, { label: "모노레일역", icon: "🚝" }, { label: "해커 은신처", icon: "🕶️" }],
      },
      math: {
        title: "크레딧 환산", intro: "뒷골목 환전 단말로 크레딧을 맞춰 주세요.", icon: "💳", unit: "크레딧",
        add: ["{a}크레딧 송금 + 수수료 {b}", "부품 {a} + 수리비 {b}"], sub: ["잔고 {a}에서 {b} 결제", "{a} 받고 {b}짜리 결제"], mul: ["{a}크레딧 탄창 {b}개", "시간당 {a} × {b}시간"],
      },
      timing: { title: "회로 잇기", intro: "신호가 흐르는 순간에 회로를 납땜하세요.", icon: "⚡", action: "납땜", hit: "접속 성공", miss: "쇼트!" },
    },
  },
  {
    id: "scifi", name: "SF", hasOfficer: true, officerTitle: "SF 구역 간부", emblem: "🚀", accent: "#8fd0c4",
    blurb: "정거장 엔진 소리가 끊이지 않는 우주항과 연구 구역.",
    work: {
      sort: {
        title: "화물 검역", intro: "입항 화물을 일반·위험·생물로 분류하세요.", icon: "🛰️",
        bins: [{ id: "normal", label: "일반", icon: "📦" }, { id: "hazard", label: "위험", icon: "☢️" }, { id: "bio", label: "생물", icon: "🧬" }],
        items: [
          { label: "보급 식량", icon: "🥫", bin: "normal" }, { label: "예비 부품", icon: "⚙️", bin: "normal" }, { label: "승무원 짐", icon: "🧳", bin: "normal" }, { label: "광물 샘플", icon: "🪨", bin: "normal" },
          { label: "반물질 셀", icon: "☢️", bin: "hazard" }, { label: "플라스마 탄", icon: "💥", bin: "hazard" }, { label: "액체 산소", icon: "🧯", bin: "hazard" }, { label: "불안정 결정", icon: "🔷", bin: "hazard" },
          { label: "외계 포자", icon: "🦠", bin: "bio" }, { label: "냉동 배아", icon: "🧊", bin: "bio" }, { label: "수경 묘목", icon: "🌱", bin: "bio" }, { label: "애완 생물", icon: "🐙", bin: "bio" },
        ],
      },
      memory: {
        title: "기관 정비 체크리스트", intro: "기관장이 부른 점검 항목을 기억해 체크하세요.", icon: "🔧", noun: "점검 목록",
        items: [{ label: "냉각수", icon: "💧" }, { label: "추진기", icon: "🚀" }, { label: "배전반", icon: "🔌" }, { label: "산소 필터", icon: "🌬️" }, { label: "항법 장치", icon: "🧭" }, { label: "보호막", icon: "🛡️" }, { label: "통신 안테나", icon: "📡" }, { label: "연료 탱크", icon: "⛽" }, { label: "중력 장치", icon: "🌀" }, { label: "센서", icon: "📟" }, { label: "에어록", icon: "🚪" }, { label: "조명", icon: "💡" }],
      },
      math: {
        title: "연료 계산", intro: "출항 전 연료 수치를 확인하세요.", icon: "⛽", unit: "단위",
        add: ["잔량 {a} + 보급 {b}", "주 탱크 {a} + 보조 {b}"], sub: ["{a}에서 도약 소모 {b}", "적재 {a} 중 하역 {b}"], mul: ["도약 {a}회 × {b}단위", "엔진 {a}기 × {b}단위"],
      },
      timing: { title: "우주항 하역", intro: "크레인이 정렬되는 순간에 컨테이너를 내리세요.", icon: "🏗️", action: "하역", hit: "정위치 하역", miss: "쿵, 빗나갔다" },
    },
  },
  {
    id: "romance", name: "로맨스판타지", hasOfficer: true, officerTitle: "로맨스판타지 구역 간부", emblem: "🌹", accent: "#e8a0b4",
    blurb: "무도회장 샹들리에와 귀족 저택이 늘어선 사교계 구역.",
    work: {
      sort: {
        title: "초대장 분류", intro: "봉랍 문장을 보고 초대장을 가문별로 나누세요.", icon: "💌",
        bins: [{ id: "duke", label: "공작가", icon: "👑" }, { id: "count", label: "백작가", icon: "🦢" }, { id: "baron", label: "남작가", icon: "🌹" }],
        items: [
          { label: "금빛 왕관 봉랍", icon: "👑", bin: "duke" }, { label: "사자 문장 봉랍", icon: "🦁", bin: "duke" }, { label: "보라 리본 초대장", icon: "🎀", bin: "duke" }, { label: "황금 테두리 카드", icon: "📜", bin: "duke" },
          { label: "백조 문장 봉랍", icon: "🦢", bin: "count" }, { label: "은빛 달 봉랍", icon: "🌙", bin: "count" }, { label: "푸른 잉크 초대장", icon: "🖋️", bin: "count" }, { label: "진주 장식 카드", icon: "🦪", bin: "count" },
          { label: "장미 문장 봉랍", icon: "🌹", bin: "baron" }, { label: "들꽃 압화 카드", icon: "🌼", bin: "baron" }, { label: "붉은 리본 초대장", icon: "❤️", bin: "baron" }, { label: "사슴 문장 봉랍", icon: "🦌", bin: "baron" },
        ],
      },
      memory: {
        title: "무도회 서빙", intro: "귀부인들이 고른 디저트를 기억해 은쟁반에 올리세요.", icon: "🍰", noun: "주문",
        items: [{ label: "마카롱", icon: "🍬" }, { label: "샴페인", icon: "🥂" }, { label: "딸기 타르트", icon: "🍓" }, { label: "홍차", icon: "☕" }, { label: "케이크", icon: "🍰" }, { label: "푸딩", icon: "🍮" }, { label: "포도", icon: "🍇" }, { label: "쿠키", icon: "🍪" }, { label: "아이스크림", icon: "🍨" }, { label: "체리", icon: "🍒" }, { label: "초콜릿", icon: "🍫" }, { label: "레모네이드", icon: "🍋" }],
      },
      math: {
        title: "드레스 공방 정산", intro: "시즌 주문이 밀렸습니다. 공방 장부를 맞추세요.", icon: "👗", unit: "코인",
        add: ["실크 {a} + 레이스 {b}", "드레스 {a} + 장갑 {b}"], sub: ["선금 {a}에서 {b} 차감", "{a} 받고 {b}짜리 리본"], mul: ["{a}코인 단추 {b}개", "레이스 {a}자 × {b}코인"],
      },
      timing: { title: "왈츠 반주", intro: "박자에 맞춰 첫 음을 넣으세요.", icon: "🎻", action: "연주", hit: "우아한 한 박", miss: "삐걱" },
    },
  },
  {
    id: "horror", name: "괴담", hasOfficer: true, officerTitle: "괴담 구역 간부", emblem: "🕯️", accent: "#9aa36b",
    blurb: "꺼지지 않는 등불과 지켜야 할 규칙이 많은, 다크판타지와 호러의 구역.",
    work: {
      sort: {
        title: "부적 분류", intro: "들어온 부적을 진품·가품·저주로 가르세요. 저주품은 만지지 말 것.", icon: "🧿",
        bins: [{ id: "real", label: "진품", icon: "📿" }, { id: "fake", label: "가품", icon: "🎭" }, { id: "cursed", label: "저주", icon: "💀" }],
        items: [
          { label: "주사 붉은 부적", icon: "🧧", bin: "real" }, { label: "은방울 부적", icon: "🔔", bin: "real" }, { label: "향 배인 부적", icon: "🪔", bin: "real" }, { label: "봉인 매듭", icon: "🪢", bin: "real" },
          { label: "인쇄된 부적", icon: "🖨️", bin: "fake" }, { label: "물에 번진 부적", icon: "💧", bin: "fake" }, { label: "글자 틀린 부적", icon: "✏️", bin: "fake" }, { label: "플라스틱 방울", icon: "🔕", bin: "fake" },
          { label: "피 묻은 부적", icon: "🩸", bin: "cursed" }, { label: "거꾸로 쓴 부적", icon: "🙃", bin: "cursed" }, { label: "속삭이는 인형", icon: "🪆", bin: "cursed" }, { label: "검게 탄 부적", icon: "🖤", bin: "cursed" },
        ],
      },
      memory: {
        title: "규칙 암기", intro: "야간 근무 규칙서의 항목을 외워 두세요. 틀리면 안 됩니다.", icon: "📋", noun: "규칙",
        items: [{ label: "등불 끄지 않기", icon: "🕯️" }, { label: "거울 보지 않기", icon: "🪞" }, { label: "대답하지 않기", icon: "🤐" }, { label: "소금 뿌리기", icon: "🧂" }, { label: "시계 확인", icon: "🕰️" }, { label: "문 세 번 두드리기", icon: "🚪" }, { label: "뒤돌아보지 않기", icon: "🙈" }, { label: "인형 세기", icon: "🪆" }, { label: "향 피우기", icon: "🪔" }, { label: "창문 닫기", icon: "🪟" }, { label: "이름 부르지 않기", icon: "📛" }, { label: "열쇠 챙기기", icon: "🗝️" }],
      },
      math: {
        title: "노잣돈 셈", intro: "망자의 배웅 값을 정확히 셈해야 문이 닫힙니다.", icon: "⚱️", unit: "푼",
        add: ["노잣돈 {a}푼 + 향값 {b}푼", "등잔 기름 {a} + 초 {b}"], sub: ["{a}푼에서 뱃삯 {b}푼", "공양 {a} 중 {b} 사용"], mul: ["초 {a}자루 × {b}푼", "{a}일 × 향 {b}푼"],
      },
      timing: { title: "등불 켜기", intro: "바람이 멎는 순간에 등불을 붙이세요.", icon: "🏮", action: "점등", hit: "불이 붙었다", miss: "무언가 불을 껐다" },
    },
  },
  {
    id: "downtown", name: "도심", hasOfficer: false, officerTitle: "", emblem: "🚉", accent: "#d4af37",
    blurb: "종착역과 환전소, 지배인의 하우스가 있는 포르투나의 중심. 어느 장르에도 속하지 않는다.",
    work: {
      sort: {
        title: "역 수하물 정리", intro: "도착 열차의 짐을 보관·분실물·파손으로 나누세요.", icon: "🧳",
        bins: [{ id: "keep", label: "보관", icon: "🧳" }, { id: "lost", label: "분실물", icon: "❓" }, { id: "broken", label: "파손", icon: "🩹" }],
        items: [
          { label: "이름표 달린 가방", icon: "🏷️", bin: "keep" }, { label: "잠긴 트렁크", icon: "🧳", bin: "keep" }, { label: "포장된 꽃다발", icon: "💐", bin: "keep" }, { label: "악기 케이스", icon: "🎻", bin: "keep" },
          { label: "주인 없는 우산", icon: "☂️", bin: "lost" }, { label: "한 짝 장갑", icon: "🧤", bin: "lost" }, { label: "낡은 사진", icon: "🖼️", bin: "lost" }, { label: "다른 세계 지폐", icon: "💵", bin: "lost" },
          { label: "깨진 시계", icon: "⌚", bin: "broken" }, { label: "찢어진 배낭", icon: "🎒", bin: "broken" }, { label: "금 간 액자", icon: "🪟", bin: "broken" }, { label: "부러진 지팡이", icon: "🦯", bin: "broken" },
        ],
      },
      memory: {
        title: "승강장 안내", intro: "승객이 물은 승강장을 기억해 순서대로 안내하세요.", icon: "🚏", noun: "안내",
        items: [{ label: "1번 승강장", icon: "1️⃣" }, { label: "2번 승강장", icon: "2️⃣" }, { label: "3번 승강장", icon: "3️⃣" }, { label: "4번 승강장", icon: "4️⃣" }, { label: "환전소", icon: "💱" }, { label: "물품 보관소", icon: "🗄️" }, { label: "하우스 입구", icon: "🎰" }, { label: "시계탑", icon: "🕰️" }, { label: "역 식당", icon: "🍽️" }, { label: "분실물 센터", icon: "❓" }, { label: "개찰구", icon: "🎫" }, { label: "대합실", icon: "🪑" }],
      },
      math: {
        title: "환전소 셈", intro: "다른 세계에서 온 돈을 코인으로 바꿔 주세요.", icon: "💱", unit: "코인",
        add: ["금화 {a} + 은화 {b}", "환전 {a} + 수수료 {b}"], sub: ["{a}코인 내고 {b}코인 환전", "{a}에서 지배인 몫 {b}"], mul: ["{a}코인짜리 동전 {b}개", "환율 {a} × {b}장"],
      },
      timing: { title: "개찰구 검표", intro: "승객이 지나가는 순간 표에 구멍을 내세요.", icon: "🎫", action: "검표", hit: "딸깍", miss: "놓쳤다" },
    },
  },
];

export const DISTRICT_BY_ID: ReadonlyMap<string, DistrictContent> = new Map(DISTRICTS.map((district) => [district.id, district]));
export function districtContent(id: string): DistrictContent { return DISTRICT_BY_ID.get(id) ?? (DISTRICTS[DISTRICTS.length - 1] as DistrictContent); }

