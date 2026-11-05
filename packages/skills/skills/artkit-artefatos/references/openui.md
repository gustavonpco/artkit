# Visual (`openui`)

OpenUI Lang for visuals: slide decks, dashboards, reports, prototypes and diagrams built from the artkit component library. One declaration per line; the first declaration is root = <Visual>(...).

Version: `openui-lang@1.1.0`

## Regras

- Start with root = Deck(...) for presentations, Dashboard, Report, Prototype or Diagram for the other visuals.
- Declare each component on its own line with a lowercase name, then reference it from a parent by that name.
- Use only components listed in the catalog with the positional arguments of their schema.
- Give every slide a Title first; keep Bullets to six items or fewer.
- Give every Image an alternative text as its second argument and an asset://<id> source.
- Edit visuals by declaration: set_statement, insert_child, move_child, rename_statement; never rewrite the whole text.

## Limites

- declarations: 2000
- slides: 100

## Exemplo: Two-slide deck

```json
[
  {
    "op": "set_statement",
    "name": "root",
    "expr": "Deck([capa, escopo])"
  },
  {
    "op": "set_statement",
    "name": "capa",
    "expr": "Slide(\"title\", [Title(\"Portal de Fornecedores\"), Subtitle(\"Grupo Meridiano\")])"
  },
  {
    "op": "set_statement",
    "name": "escopo",
    "expr": "Slide(\"title-content\", [Title(\"Escopo em 13 módulos\"), Bullets([\"Cadastro e homologação\", \"Integração Protheus\"])])"
  }
]
```
