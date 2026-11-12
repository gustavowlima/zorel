// What a turn's work adds up to (apps/web/src/features/steps.ts, chat.tsx endingOf): each kind counted in the order
// work goes ("Read 2 files and ran 3 commands"), files an edit touched counted once, only failures that still stand;
// a reply cut where its steps began (text · steps · text); and how a turn ended. Pure, so it is tested here.
use rust_i18n::t;

use crate::{format, i18n::tn};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Search,
    Read,
    Edit,
    Run,
    Tool,
    Delegate,
}

const ORDER: [Kind; 6] = [
    Kind::Search,
    Kind::Read,
    Kind::Edit,
    Kind::Run,
    Kind::Tool,
    Kind::Delegate,
];

impl Kind {
    fn key(self) -> &'static str {
        match self {
            Kind::Search => "search",
            Kind::Read => "read",
            Kind::Edit => "edit",
            Kind::Run => "run",
            Kind::Tool => "tool",
            Kind::Delegate => "delegate",
        }
    }
}

/// Native kinds keep their name; Zorel's timing rows (thought, reply) aren't work; anything else is a tool (MCP).
pub fn kind_of(tool: &str) -> Option<Kind> {
    match tool {
        "thought" | "reply" => None,
        other => Some(ORDER.into_iter().find(|k| k.key() == other).unwrap_or(Kind::Tool)),
    }
}

/// A step as the summary reads it (a saved one or a live one).
pub struct Summed<'a> {
    pub kind: &'a str,
    pub status: &'a str,
    /// What identifies a retry of the same step (its command or path).
    pub detail: &'a str,
    pub files: Vec<&'a str>,
}

pub struct Summary {
    pub parts: Vec<(Kind, usize)>,
    pub failed: usize,
    pub refused: usize,
}

pub fn summarize(steps: &[Summed]) -> Summary {
    let mut counts = [0usize; 6];
    let mut edited: Vec<&str> = Vec::new();
    for s in steps {
        let Some(kind) = kind_of(s.kind) else { continue };
        if kind == Kind::Edit && !s.files.is_empty() {
            for f in &s.files {
                if !edited.contains(f) {
                    edited.push(f);
                }
            }
        } else {
            counts[ORDER.iter().position(|k| *k == kind).unwrap_or(4)] += 1;
        }
    }
    counts[2] += edited.len();
    // A failure stands unless the same step (kind and command or path) passed after it.
    let failed = steps
        .iter()
        .enumerate()
        .filter(|(i, s)| {
            s.status == "error"
                && kind_of(s.kind).is_some()
                && !steps[i + 1..]
                    .iter()
                    .any(|later| later.status == "ok" && later.kind == s.kind && later.detail == s.detail)
        })
        .count();
    let refused = steps.iter().filter(|s| s.status == "refused").count();
    Summary {
        parts: ORDER
            .iter()
            .zip(counts)
            .filter(|(_, n)| *n > 0)
            .map(|(k, n)| (*k, n))
            .collect(),
        failed,
        refused,
    }
}

/// "Read 2 files and ran 3 commands", in the interface language.
pub fn sentence(summary: &Summary) -> String {
    let words: Vec<String> = summary
        .parts
        .iter()
        .map(|(k, n)| tn(&format!("activity.did.{}", k.key()), *n as i64))
        .collect();
    let text = format::list(&words, format::lang());
    let mut chars = text.chars();
    chars
        .next()
        .map(|c| c.to_uppercase().chain(chars).collect())
        .unwrap_or_default()
}

/// A piece of a reply laid out as it happened.
#[derive(Debug, PartialEq)]
pub enum Piece<T> {
    Text(String),
    Steps(Vec<T>),
}

/// The reply's text cut where steps began (`at` = a character offset into the text): each run of steps with no words
/// between them one group. Steps that don't know where they began form one group: above the text when none knows,
/// after it when some do.
pub fn interleave<T: Clone>(text: &str, steps: &[T], at_of: impl Fn(&T) -> Option<usize>) -> Vec<Piece<T>> {
    if steps.is_empty() {
        return if text.is_empty() {
            Vec::new()
        } else {
            vec![Piece::Text(text.to_string())]
        };
    }
    let chars: Vec<char> = text.chars().collect();
    let mut placed: Vec<(usize, usize, &T)> = steps
        .iter()
        .enumerate()
        .filter_map(|(i, s)| at_of(s).map(|at| (at.min(chars.len()), i, s)))
        .collect();
    let loose: Vec<T> = steps.iter().filter(|s| at_of(s).is_none()).cloned().collect();
    if placed.is_empty() {
        let mut out = vec![Piece::Steps(loose)];
        if !text.is_empty() {
            out.push(Piece::Text(text.to_string()));
        }
        return out;
    }
    placed.sort_by_key(|(at, i, _)| (*at, *i));
    let mut out: Vec<Piece<T>> = Vec::new();
    let mut cursor = 0;
    for (at, _, s) in placed {
        let between: String = chars[cursor..at].iter().collect();
        match out.last_mut() {
            Some(Piece::Steps(group)) if between.trim().is_empty() => group.push(s.clone()),
            _ => {
                if !between.trim().is_empty() {
                    out.push(Piece::Text(between));
                }
                out.push(Piece::Steps(vec![s.clone()]));
            }
        }
        cursor = at;
    }
    let rest: String = chars[cursor..].iter().collect();
    if !rest.trim().is_empty() {
        out.push(Piece::Text(rest));
    }
    if !loose.is_empty() {
        out.push(Piece::Steps(loose));
    }
    out
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Tone {
    Warning,
    Danger,
}

/// How a turn ended, from its error: stopped, cancelled, restarted, a limit (warning), or a failure (danger).
pub fn ending(error: Option<&str>) -> Option<(Tone, String)> {
    let error = error?;
    const CODES: [(&str, &str); 4] = [
        ("cancelled", "chat.cancelled"),
        ("server_restarted", "chat.serverRestarted"),
        ("reply_limit", "chat.replyLimit"),
        ("monthly_limit", "chat.monthlyLimit"),
    ];
    if let Some((_, key)) = CODES.iter().find(|(code, _)| *code == error) {
        return Some((Tone::Warning, t!(*key).into_owned()));
    }
    if error == "interrupted" || error.starts_with("interrompido") {
        return Some((Tone::Warning, t!("chat.interrupted").into_owned()));
    }
    Some((Tone::Danger, error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn step<'a>(kind: &'a str, status: &'a str, detail: &'a str) -> Summed<'a> {
        Summed {
            kind,
            status,
            detail,
            files: Vec::new(),
        }
    }

    #[test]
    fn work_is_counted_by_kind_and_fixed_failures_drop() {
        let mut edit = step("edit", "ok", "");
        edit.files = vec!["a.rs", "b.rs"];
        let mut again = step("edit", "ok", "");
        again.files = vec!["a.rs"];
        let steps = [
            step("read", "ok", "x"),
            edit,
            again,
            step("run", "error", "bun test"),
            step("run", "ok", "bun test"),
            step("run", "error", "cargo test"),
            step("thought", "ok", ""),
            step("mcp__x", "refused", "y"),
        ];
        let s = summarize(&steps);
        assert_eq!(
            s.parts,
            [(Kind::Read, 1), (Kind::Edit, 2), (Kind::Run, 3), (Kind::Tool, 1)]
        );
        assert_eq!((s.failed, s.refused), (1, 1));
    }

    #[test]
    fn a_reply_is_cut_where_its_steps_began() {
        let pieces = interleave("Let me look. Found it.", &[(Some(13), 'a'), (Some(13), 'b')], |s| s.0);
        assert_eq!(
            pieces,
            [
                Piece::Text("Let me look. ".into()),
                Piece::Steps(vec![(Some(13), 'a'), (Some(13), 'b')]),
                Piece::Text("Found it.".into()),
            ]
        );
        let loose = interleave("Done", &[(None, 'x')], |s: &(Option<usize>, char)| s.0);
        assert_eq!(loose, [Piece::Steps(vec![(None, 'x')]), Piece::Text("Done".into())]);
    }

    #[test]
    fn endings_read_their_codes() {
        assert_eq!(ending(None), None);
        assert_eq!(ending(Some("boom")).map(|e| e.0), Some(Tone::Danger));
        assert_eq!(ending(Some("interrupted")).map(|e| e.0), Some(Tone::Warning));
    }
}
