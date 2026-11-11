// A span of days (shadcn `--base aria` style, on Zorel's tokens): React Aria's DateRangePicker, two typed date
// fields in one body with a calendar button that opens a range calendar in a popover. Keyboard: type the
// segments, or open the calendar and move with the arrows. Values are "yyyy-mm-dd" strings (or null), in the
// computer's own calendar; either end may stay open.
import { type CalendarDate, parseDate } from "@internationalized/date"
import {
  Button,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  DateInput,
  DateRangePicker,
  DateSegment,
  Dialog,
  Group,
  Heading,
  Popover,
  RangeCalendar
} from "react-aria-components"
import { cn } from "@/lib/utils"
import { CalendarDays, ChevronRight, X } from "./icons"

export type DayRange = { readonly start: string | null; readonly end: string | null }

const parse = (s: string | null): CalendarDate | null => (s ? parseDate(s) : null)

const segment =
  "rounded-sm px-0.5 tabular-nums outline-none data-placeholder:text-dim data-focused:bg-accent-soft data-focused:text-fg data-[type=literal]:px-0 data-[type=literal]:text-dim"
const nav =
  "flex size-control-xs cursor-default items-center justify-center rounded-control text-muted outline-none data-hovered:bg-hover data-hovered:text-fg data-focus-visible:ring-2 data-focus-visible:ring-accent"

export function DateRangeField({ label, value, onChange, clearLabel, openLabel, className }: { label: string; value: DayRange; onChange: (v: DayRange) => void; clearLabel: string; openLabel: string; className?: string }) {
  const start = parse(value.start)
  const end = parse(value.end)
  const range = start && end ? { start, end } : null
  return (
    <DateRangePicker
      aria-label={label}
      value={range}
      onChange={(r) => onChange({ start: r ? r.start.toString() : null, end: r ? r.end.toString() : null })}
      className={cn("group inline-flex", className)}
    >
      <Group className="flex h-control items-center gap-1 rounded-control border border-subtle bg-control pr-1 pl-3 text-base text-fg transition-colors data-hovered:border-strong data-focus-within:border-strong data-focus-visible:ring-2 data-focus-visible:ring-accent-soft">
        <DateInput slot="start" className="flex items-center">
          {(s) => <DateSegment segment={s} className={segment} />}
        </DateInput>
        <span aria-hidden="true" className="px-1 text-dim">
          –
        </span>
        <DateInput slot="end" className="flex items-center">
          {(s) => <DateSegment segment={s} className={segment} />}
        </DateInput>
        {range && (
          <Button aria-label={clearLabel} onPress={() => onChange({ start: null, end: null })} className={nav}>
            <X className="size-3.5" />
          </Button>
        )}
        <Button aria-label={openLabel} className={nav}>
          <CalendarDays className="size-4" />
        </Button>
      </Group>
      <Popover
        offset={8}
        placement="bottom end"
        className="z-50 rounded-sheet border border-strong bg-float p-3 text-fg shadow-float outline-none backdrop-blur-xl backdrop-saturate-150 data-entering:animate-in data-entering:fade-in-0 data-entering:zoom-in-[0.98] data-exiting:animate-out data-exiting:fade-out-0 motion-reduce:animate-none"
      >
        <Dialog className="outline-none">
          <RangeCalendar className="flex flex-col gap-2">
            <header className="flex items-center gap-1">
              <Button slot="previous" className={nav}>
                <ChevronRight className="size-4 rotate-180" />
              </Button>
              <Heading className="flex-1 text-center text-sm font-medium" />
              <Button slot="next" className={nav}>
                <ChevronRight className="size-4" />
              </Button>
            </header>
            <CalendarGrid className="border-separate border-spacing-y-0.5">
              <CalendarGridHeader>{(day) => <CalendarHeaderCell className="size-8 text-xs font-normal text-dim">{day}</CalendarHeaderCell>}</CalendarGridHeader>
              <CalendarGridBody>
                {(date) => (
                  <CalendarCell
                    date={date}
                    className="flex size-8 cursor-default items-center justify-center text-sm tabular-nums outline-none data-outside-month:invisible data-hovered:bg-hover data-disabled:text-dim data-selected:bg-accent-soft data-selected:text-fg data-selection-start:rounded-l-control data-selection-end:rounded-r-control data-selection-start:bg-accent data-selection-end:bg-accent data-selection-start:text-on-accent data-selection-end:text-on-accent data-focus-visible:ring-2 data-focus-visible:ring-accent"
                  />
                )}
              </CalendarGridBody>
            </CalendarGrid>
          </RangeCalendar>
        </Dialog>
      </Popover>
    </DateRangePicker>
  )
}
