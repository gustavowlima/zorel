// Interface text (spec 019): the catalog is packages/i18n, exported to locales/<lang>.json by `bun run i18n:native`.
// t!("key") for a text, tn("key", n) for a plural; `bun run check:i18n` fails on a key the catalog lacks (rust-i18n
// would otherwise show the key itself).
use icu_plurals::{PluralCategory, PluralRuleType, PluralRules, PluralRulesOptions};

/// The catalog's languages, as packages/i18n names them.
const LANGUAGES: [&str; 2] = ["en", "pt-BR"];

/// The system's language when Zorel has it, else English (packages/i18n: a Portuguese system gets pt-BR).
pub fn init() {
    let system = sys_locale::get_locale().unwrap_or_default().to_lowercase();
    let lang = if system.starts_with("pt") { "pt-BR" } else { "en" };
    rust_i18n::set_locale(lang);
}

/// A plural message: `{one, other}` in the catalog, picked by the current language's rules, `%{count}` filled.
pub fn tn(key: &str, count: i64) -> String {
    let locale = rust_i18n::locale();
    let one = plural_rules(&locale).category_for(count.unsigned_abs()) == PluralCategory::One;
    let text = rust_i18n::t!(format!("{key}.{}", if one { "one" } else { "other" }), count = count);
    text.into_owned()
}

fn plural_rules(locale: &str) -> PluralRules {
    let tag = if LANGUAGES.contains(&locale) { locale } else { "en" };
    let locale: icu_locale_core::Locale = tag.parse().expect("a valid language tag");
    PluralRules::try_new(
        locale.into(),
        PluralRulesOptions::default().with_type(PluralRuleType::Cardinal),
    )
    .expect("plural rules for a catalog language")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plurals_follow_the_language() {
        rust_i18n::set_locale("en");
        assert_eq!(tn("inbox.waiting", 1), "1 waiting · the rest goes on by itself");
        assert_eq!(tn("inbox.waiting", 3), "3 waiting · the rest goes on by itself");
        rust_i18n::set_locale("pt-BR");
        assert_eq!(tn("inbox.waiting", 2), "2 esperando · o resto segue sozinho");
        assert_eq!(rust_i18n::t!("app.starting"), "Iniciando o Zorel…");
        rust_i18n::set_locale("en");
    }
}
