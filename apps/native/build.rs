// Wire types from the contract (spec 019 T015): packages/contracts/schema/wire.json (generated from the Effect Schemas
// by `bun run schema`) becomes Rust types with typify, written to OUT_DIR/wire.rs and included by src/net/types.rs.
use std::{env, fs, path::Path};

use serde_json::Value;

const WIRE: &str = "../../packages/contracts/schema/wire.json";

fn main() {
    println!("cargo:rerun-if-changed={WIRE}");
    let mut doc: Value =
        serde_json::from_str(&fs::read_to_string(WIRE).expect("read wire.json")).expect("parse wire.json");
    normalize(&mut doc);
    let defs = doc
        .as_object_mut()
        .and_then(|o| o.remove("$defs"))
        .expect("wire.json has $defs");
    // typify reads draft-07 shapes: definitions under "definitions", referenced as #/definitions/….
    let defs: std::collections::BTreeMap<String, schemars::schema::Schema> =
        serde_json::from_value(defs).expect("definitions are JSON Schema");
    let mut space = typify::TypeSpace::new(typify::TypeSpaceSettings::default().with_struct_builder(false));
    space.add_ref_types(defs).expect("typify accepts the wire types");
    let file = syn::parse2::<syn::File>(space.to_stream()).expect("typify output parses");
    let out = Path::new(&env::var("OUT_DIR").unwrap()).join("wire.rs");
    fs::write(out, prettyplease::unparse(&file)).expect("write wire.rs");
}

// Rewrites what typify can't read and what this client never sends or meets:
// - refs to #/$defs/X become #/definitions/X;
// - `additionalProperties: true` (Effect writes it on every struct) is the default anyway; typify only builds
//   structs and tagged enums (`_tag` events, `t` socket frames) from objects without it. Unknown fields are still
//   ignored when decoding;
// - "anything but null" (`not: {type: null}`, a flow step's free-form config) is read as any JSON value;
// - Effect's JSON codec writes a non-finite number as the string "Infinity"/"-Infinity"/"NaN", so every number is
//   anyOf [number, those strings(, null)]; the engine sends finite numbers, so that member is dropped and a lone
//   remaining member replaces the anyOf (a plain number, or number | null → Option<f64>).
fn normalize(v: &mut Value) {
    match v {
        Value::Object(o) => {
            if let Some(Value::String(r)) = o.get_mut("$ref") {
                *r = r.replacen("#/$defs/", "#/definitions/", 1);
            }
            if o.get("additionalProperties") == Some(&Value::Bool(true)) {
                o.remove("additionalProperties");
            }
            if o.get("not") == Some(&serde_json::json!({ "type": "null" })) {
                o.remove("not");
            }
            if let Some(Value::Array(any)) = o.get_mut("anyOf") {
                any.retain(|m| *m != non_finite());
                if any.len() == 1 {
                    let only = any.remove(0);
                    o.remove("anyOf");
                    if let Value::Object(only) = only {
                        o.extend(only);
                    }
                }
            }
            o.values_mut().for_each(normalize);
        }
        Value::Array(a) => a.iter_mut().for_each(normalize),
        _ => {}
    }
}

// The member Effect adds next to every number for non-finite values.
fn non_finite() -> Value {
    serde_json::json!({ "type": "string", "enum": ["Infinity", "-Infinity", "NaN"] })
}
