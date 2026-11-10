// The Routines week (routine-week.tsx): where runs close in time sit, side by side, as in a calendar.
// Blocks that overlap share the column side by side, like a calendar: each gets a lane and the lanes of its group.
export function lanesOf<B extends { minutes: number }>(blocks: ReadonlyArray<B>, blockMinutes = 52): Array<B & { lane: number; lanes: number }> {
  const sorted = [...blocks].sort((a, b) => a.minutes - b.minutes)
  const out: Array<B & { lane: number; lanes: number }> = []
  let group: Array<B & { lane: number; lanes: number }> = []
  let groupEnd = -1
  const close = () => {
    const lanes = Math.max(1, ...group.map((g) => g.lane + 1))
    for (const g of group) out.push({ ...g, lanes })
    group = []
  }
  for (const b of sorted) {
    if (b.minutes >= groupEnd) close()
    const busy = new Set(group.filter((g) => g.minutes + blockMinutes > b.minutes).map((g) => g.lane))
    let lane = 0
    while (busy.has(lane)) lane++
    group.push({ ...b, lane, lanes: 1 })
    groupEnd = Math.max(groupEnd, b.minutes + blockMinutes)
  }
  close()
  return out
}

// A routine's schedule moved by a drag on the week: "<minute> <hour> * * <days>" (a time on some days) is movable;
// one weekday follows the drop's day, a set of days ("*", "1-5", "1,3") keeps its days and only the time moves.
// Anything else (every hour, every 15 minutes, a day of the month) isn't: undefined.
const SIMPLE = /^(\d{1,2}) (\d{1,2}) \* \* (\*|[0-7](?:[-,][0-7])*)$/
export function moveCron(cron: string, weekday: number, minutes: number): string | undefined {
  const m = SIMPLE.exec(cron.trim())
  if (!m) return undefined
  const days = /^[0-7]$/.test(m[3]!) ? String(weekday) : m[3]!
  return `${minutes % 60} ${Math.floor(minutes / 60)} * * ${days}`
}
