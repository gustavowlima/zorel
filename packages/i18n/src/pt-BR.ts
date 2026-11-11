// Catálogo pt-BR: as mesmas chaves de en.ts (o typecheck quebra se faltar ou sobrar uma). Strings de interface só;
// conteúdo do usuário nunca passa por aqui.
import type { en } from "./en.ts"
import { part1 } from "./pt-BR/part1.ts"
import { part2 } from "./pt-BR/part2.ts"
import { part3 } from "./pt-BR/part3.ts"

type Shape<T> = { readonly [K in keyof T]: T[K] extends string ? string : Shape<T[K]> }
export const ptBR = { ...part1, ...part2, ...part3 } satisfies Shape<typeof en>
