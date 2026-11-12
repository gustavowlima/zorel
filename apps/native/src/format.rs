// Numbers, ages, times and dates as the web shows them (packages/i18n formatAge / formatTime / formatDuration and the
// browser's Intl), per catalog language. Intl isn't available natively, so each language's forms are spelled here;
// the tests pin them to what Intl prints (checked with Bun on 2026-11-12).
use chrono::{DateTime, Datelike, Local, TimeZone, Timelike};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Lang {
    En,
    PtBr,
}

pub fn lang() -> Lang {
    if rust_i18n::locale().starts_with("pt") {
        Lang::PtBr
    } else {
        Lang::En
    }
}

const MONTHS_SHORT: [[&str; 12]; 2] = [
    [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ],
    [
        "jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez.",
    ],
];
const MONTHS_LONG: [[&str; 12]; 2] = [
    [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ],
    [
        "janeiro",
        "fevereiro",
        "março",
        "abril",
        "maio",
        "junho",
        "julho",
        "agosto",
        "setembro",
        "outubro",
        "novembro",
        "dezembro",
    ],
];
const WEEKDAYS: [[&str; 7]; 2] = [
    [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
    ],
    [
        "segunda-feira",
        "terça-feira",
        "quarta-feira",
        "quinta-feira",
        "sexta-feira",
        "sábado",
        "domingo",
    ],
];

fn ix(l: Lang) -> usize {
    match l {
        Lang::En => 0,
        Lang::PtBr => 1,
    }
}

fn local(ms: f64) -> DateTime<Local> {
    Local
        .timestamp_millis_opt(ms as i64)
        .single()
        .unwrap_or_else(Local::now)
}

pub fn now_ms() -> f64 {
    Local::now().timestamp_millis() as f64
}

/// A count with a narrow unit: 14s, 5m / 5min, 3d / 3 dias, 2w / 2 sem.
fn unit(l: Lang, u: char, n: i64) -> String {
    match (l, u) {
        (Lang::En, 's') => format!("{n}s"),
        (Lang::En, 'm') => format!("{n}m"),
        (Lang::En, 'h') => format!("{n}h"),
        (Lang::En, 'd') => format!("{n}d"),
        (Lang::En, _) => format!("{n}w"),
        (Lang::PtBr, 's') => format!("{n}s"),
        (Lang::PtBr, 'm') => format!("{n}min"),
        (Lang::PtBr, 'h') => format!("{n}h"),
        (Lang::PtBr, 'd') => format!("{n} {}", if n == 1 { "dia" } else { "dias" }),
        (Lang::PtBr, _) => format!("{n} sem."),
    }
}

const SANE_SINCE: f64 = 946_684_800_000.; // 2000-01-01: older is not a real timestamp here

/// Short age for lists: now, 5m, 2h, 3d, 2w; older than 8 weeks the date (Mar 4, or Mar 4, 2025).
pub fn age(at: f64, now: f64, l: Lang) -> String {
    if at.is_nan() || at < SANE_SINCE {
        return String::new();
    }
    let s = ((now - at) / 1000.).max(0.);
    match s {
        s if s < 60. => rust_i18n::t!("time.now").into_owned(),
        s if s < 3600. => unit(l, 'm', (s / 60.) as i64),
        s if s < 86_400. => unit(l, 'h', (s / 3600.) as i64),
        s if s < 86_400. * 14. => unit(l, 'd', (s / 86_400.) as i64),
        s if s < 86_400. * 56. => unit(l, 'w', (s / (86_400. * 7.)) as i64),
        _ if local(at).year() == local(now).year() => day_month(at, l),
        _ => date(at, l),
    }
}

fn day_month(at: f64, l: Lang) -> String {
    let d = local(at);
    let month = MONTHS_SHORT[ix(l)][d.month0() as usize];
    match l {
        Lang::En => format!("{month} {}", d.day()),
        Lang::PtBr => format!("{} de {month}", d.day()),
    }
}

/// A medium date: Mar 4, 2025 / 4 de mar. de 2025.
pub fn date(at: f64, l: Lang) -> String {
    let d = local(at);
    match l {
        Lang::En => format!("{}, {}", day_month(at, l), d.year()),
        Lang::PtBr => format!("{} de {}", day_month(at, l), d.year()),
    }
}

fn clock(at: f64, l: Lang) -> String {
    let d = local(at);
    match l {
        Lang::En => {
            let (pm, h) = d.hour12();
            format!("{h:02}:{:02} {}", d.minute(), if pm { "PM" } else { "AM" })
        }
        Lang::PtBr => format!("{:02}:{:02}", d.hour(), d.minute()),
    }
}

/// 14:30 today; Mar 4 at 02:30 PM / 4 de mar., 14:30 on another day.
pub fn time(at: f64, now: f64, l: Lang) -> String {
    if local(at).date_naive() == local(now).date_naive() {
        return clock(at, l);
    }
    match l {
        Lang::En => format!("{} at {}", day_month(at, l), clock(at, l)),
        Lang::PtBr => format!("{}, {}", day_month(at, l), clock(at, l)),
    }
}

/// The greeting's date: Thursday, November 12 / quinta-feira, 12 de novembro.
pub fn weekday_date(at: f64, l: Lang) -> String {
    let d = local(at);
    let (weekday, month) = (
        WEEKDAYS[ix(l)][d.weekday().num_days_from_monday() as usize],
        MONTHS_LONG[ix(l)][d.month0() as usize],
    );
    match l {
        Lang::En => format!("{weekday}, {month} {}", d.day()),
        Lang::PtBr => format!("{weekday}, {} de {month}", d.day()),
    }
}

/// The hour of a timestamp in local time (the greeting's morning/afternoon/evening).
pub fn hour(at: f64) -> u32 {
    local(at).hour()
}

/// 14s · 2m 10s · 1h 40m.
pub fn duration(ms: f64, l: Lang) -> String {
    let s = (ms / 1000.).round() as i64;
    if s < 60 {
        return unit(l, 's', s);
    }
    let m = s / 60;
    if m < 60 {
        return if s % 60 != 0 {
            format!("{} {}", unit(l, 'm', m), unit(l, 's', s % 60))
        } else {
            unit(l, 'm', m)
        };
    }
    let h = m / 60;
    if m % 60 != 0 {
        format!("{} {}", unit(l, 'h', h), unit(l, 'm', m % 60))
    } else {
        unit(l, 'h', h)
    }
}

/// "Ana, Rex, and Leo" / "Ana, Rex e Leo".
pub fn list(items: &[String], l: Lang) -> String {
    let and = match l {
        Lang::En => "and",
        Lang::PtBr => "e",
    };
    match items {
        [] => String::new(),
        [one] => one.clone(),
        [a, b] => format!("{a} {and} {b}"),
        [rest @ .., last] => match l {
            Lang::En => format!("{}, and {last}", rest.join(", ")),
            Lang::PtBr => format!("{} e {last}", rest.join(", ")),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{Lang, date, duration, list, unit, weekday_date};
    use chrono::{Local, TimeZone};

    fn at(y: i32, m: u32, d: u32, h: u32, min: u32) -> f64 {
        Local
            .with_ymd_and_hms(y, m, d, h, min, 0)
            .single()
            .expect("a local time")
            .timestamp_millis() as f64
    }

    #[test]
    fn match_intl() {
        assert_eq!([unit(Lang::En, 'm', 5), unit(Lang::PtBr, 'm', 5)], ["5m", "5min"]);
        assert_eq!(
            [
                unit(Lang::En, 'd', 3),
                unit(Lang::PtBr, 'd', 3),
                unit(Lang::PtBr, 'w', 2)
            ],
            ["3d", "3 dias", "2 sem."]
        );
        assert_eq!(date(at(2025, 3, 4, 9, 0), Lang::En), "Mar 4, 2025");
        assert_eq!(date(at(2025, 3, 4, 9, 0), Lang::PtBr), "4 de mar. de 2025");
        assert_eq!(weekday_date(at(2026, 11, 12, 9, 0), Lang::En), "Thursday, November 12");
        assert_eq!(
            weekday_date(at(2026, 11, 12, 9, 0), Lang::PtBr),
            "quinta-feira, 12 de novembro"
        );
        let three = ["Ana".to_string(), "Rex".to_string(), "Leo".to_string()];
        assert_eq!(
            [list(&three, Lang::En), list(&three, Lang::PtBr)],
            ["Ana, Rex, and Leo", "Ana, Rex e Leo"]
        );
        assert_eq!(duration(130_000., Lang::En), "2m 10s");
        assert_eq!(
            super::time(at(2026, 3, 4, 14, 30), at(2026, 3, 5, 9, 0), Lang::En),
            "Mar 4 at 02:30 PM"
        );
        assert_eq!(
            super::time(at(2026, 3, 4, 14, 30), at(2026, 3, 5, 9, 0), Lang::PtBr),
            "4 de mar., 14:30"
        );
    }
}
