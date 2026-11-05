# Documento (`markdown`)

Markdown (GFM with frontmatter) for text to read, review or sign. Read the outline first, then change sections by anchor.

Version: `gfm@1`

## Regras

- Address sections by their anchor from the outline; never by line numbers.
- Use replace_text for a small change; it fails when the snippet is not unique inside the section.
- Use replace_section for a whole body; subsections are kept.
- Create headings with insert_section; set an explicit anchor with {#id} only when the section must keep it across renames.
- Do not write raw HTML; use the pagebreak directive <!-- pagebreak --> only where a page break is needed.
- Use alert blocks (> [!NOTE], > [!WARNING], > [!TIP]) for callouts and asset://<id> for images with alt text.

## Limites

- chars: 200000
- sections: 300

## Exemplo: Create a document skeleton

```json
[
  {
    "op": "insert_section",
    "title": "Escopo",
    "level": 1,
    "body": "Resumo do escopo."
  },
  {
    "op": "insert_section",
    "after": "escopo",
    "title": "Premissas",
    "level": 2,
    "body": "- Ambiente em nuvem."
  }
]
```
