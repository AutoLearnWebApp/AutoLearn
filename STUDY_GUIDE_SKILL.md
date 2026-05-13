# Study Guide Builder — Deployable Skill Spec

A self-contained instruction set any AI provider (Groq, Gemini, Claude, GPT-4, custom) can use to produce a study guide section in the AutoLearn format. Drop this spec into the system/user prompt and pass the section + source material — the AI will emit JSON segments that AutoLearn renders.

This skill replicates a hand-tuned comparative study-guide structure: dense tables, exam-tip callouts, key insights, concrete examples, and zero filler. It's optimized for exam prep where the learner reads top-to-bottom, highlights what they know, and revisits what they don't.

---

## 1. Inputs

| Field | Required | Description |
|---|---|---|
| `topicTitle` | yes | The overall course or subject (e.g., "Strategic Management") |
| `section.title` | yes | The section being covered (e.g., "Chapter 7 — Corporate Strategy") |
| `section.description` | yes | One-sentence purpose of the section |
| `section.concepts[]` | yes | Array of `{name, description}` — concepts to cover in this section |
| `lessonText` | optional | AI-generated lesson text derived from source (use for context) |
| `sourceContent` | yes/strong | ORIGINAL source material (PDF/doc text) — the ground truth |
| `alreadyCoveredTitles[]` | optional | Concept titles already covered in earlier sections — skip these |

---

## 2. Output Format

Return **only** a JSON array of segment objects. No prose around it. No code fences. Just the array.

```json
[
  {
    "title": "Specific Concept Name (varied, not formulaic)",
    "content": "Markdown body — see formatting rules below"
  }
]
```

Each segment covers **one focused concept**. A section typically produces 3–10 segments.

---

## 3. The Five Cardinal Rules

1. **SOURCE-ONLY FIDELITY.** Every fact, example, definition, formula, and exam tip must trace back to `sourceContent` or `lessonText`. **Never invent.** If the source doesn't say it, you don't say it. When in doubt, omit.
2. **COMPLETENESS.** Scan the source for every distinct theory, term, case, principle, formula, example, and named entity that fits this section. None gets dropped. Numbered lists (Theory 1, 2, 3...) must all appear.
3. **NO REPETITION.** If a concept is in `alreadyCoveredTitles[]`, skip it entirely. Each concept appears exactly once across the whole guide.
4. **DENSITY > LENGTH.** Bullets over paragraphs. Tables over bullet lists for any comparison. Strip "this is important," "it should be noted," "in other words" — they earn no place.
5. **EXAM-TESTABLE FRAMING.** Where the source signals importance (bolding, repetition, "★ exam," "key concept," "most tested"), emit a `★ EXAM TIP:` callout. Where the source synthesizes across ideas, emit a `💡 KEY INSIGHT:` callout.

---

## 4. Content Format — The DOCX Pattern

Every segment follows this rhythm:

```
[1-line purpose statement — what this concept is for, in plain language]

[Comparison/structure table — see table syntax below]

[> ★ EXAM TIP: the specific test-worthy fact or pattern from the source]

[> 💡 KEY INSIGHT: synthesis across concepts — only when source warrants it]
```

Not every segment needs all four — but the purpose line and at least one structured element (table or bullets) are required.

### 4a. Tables (use whenever comparing or listing typed items)

GitHub-flavored markdown pipe tables. **Two-column** is the most common: `Type | Description`, `Term | Definition`, `Letter | Meaning`. Three- and four-column tables are used when an extra axis matters (e.g., `Strategy | Market Position | Market Size | Example`).

```
| Type | Description |
|---|---|
| **Forward Integration** | Stepping into your customer's domain. Example: Disney launching Disney+ |
| **Backward Integration** | Stepping into your supplier's domain. Example: Tesla manufacturing its own batteries |
```

**Table rules:**
- Bold the term/name in the first column: `**Term**`
- Every row has a concrete example baked into the description when the source provides one
- 2–4 columns max
- Header row required, separator row required (`|---|---|`)
- Don't pad cells with spaces — keep it tight

### 4b. Exam Tip Callouts

Format: a single line starting with `> ★ EXAM TIP:` and ending with a period. One short sentence stating the test-worthy pattern.

```
> ★ EXAM TIP: Forward integration moves TOWARD the customer. Backward moves TOWARD the supplier.
```

Use when the source explicitly flags importance, when an exact phrase appears in practice questions, or when two terms are commonly confused on tests.

### 4c. Key Insight Callouts

Format: a single line starting with `> 💡 KEY INSIGHT:`. Used for synthesis — connecting two or more ideas the source treats together.

```
> 💡 KEY INSIGHT: Technology rarely creates sustainable advantage alone — the defensible asset is a SYSTEM of tech + data + organization + customer relationships.
```

Use sparingly. At most one per segment. Only when the source actually synthesizes — don't manufacture insight.

### 4d. Bullets (when a table doesn't fit)

For lists that don't have parallel structure (e.g., loose criteria, prerequisites):

```
- **Term** — definition (one sentence)
- **Term** — definition (one sentence)
```

Always bold the term, then an em-dash, then the definition.

### 4e. Inline emphasis

- `**bold**` for key terms and named entities
- `*italic*` for foreign words, book/case titles, or light emphasis
- Avoid both at once

---

## 5. Title Rules

Titles are a table of contents — each one tells the reader exactly what they'll learn.

**GOOD:** `"BCG Matrix — Portfolio Planning Tool"`, `"Forward vs. Backward Integration"`, `"4 Multinational Strategic Postures"`, `"Porter's Five Forces"`

**BAD:** `"What Is X?"`, `"Understanding X"`, `"Key Concepts of X"`, `"How X Works"`, `"Introduction to X"` — all lazy templates.

Rules:
- Use the **real name** of the concept from the source
- Never reuse a title structure twice in a guide
- Use em-dashes (—) to add clarification: `"Triple Bottom Line — Planet, People, Profit"`
- Numbered counts when the source supplies them: `"6 Risks of Going Multinational"`

---

## 6. What to Exclude (Noise Filter)

Even if these appear in the source, **drop them silently**:

- Course logistics: schedules, due dates, office hours, syllabi pointers
- Professor announcements, grade distributions, class averages
- Practice questions reproduced verbatim (read them for hints about emphasis, but don't paste them)
- Slide numbers, page headers/footers, copyright lines, watermarks
- Discussion prompts ("Class discussion:", "Think about...") — absorb the topic, drop the prompt
- Instructor anecdotes unrelated to subject matter
- Administrative notes ("see chapter X", "reread section Y")
- Filler phrases inside the content itself

If a sentence's only job is transition or emphasis, kill it.

---

## 7. Section-Level Strategy

When the section has multiple concepts:

1. **Order matters.** Mirror the source's order (chapter order, slide order) so multi-section guides stay coherent.
2. **One concept per segment** is the default. Split a concept into multiple segments **only** when it has genuinely distinct sub-ideas (e.g., "VRIO Framework" and "VRIO Applied to Amazon Go" are two segments).
3. **Skip the redundant.** If `alreadyCoveredTitles[]` contains a concept name, return zero segments for it.
4. If the entire concept list was already covered, return `[]` (empty array).

---

## 8. Worked Example (what good output looks like)

Input section: "Corporate-Level Strategy — Diversification"
Source mentions: horizontal/vertical integration, BCG matrix, related vs. unrelated, retrenchment.

Expected output (abbreviated to two segments):

```json
[
  {
    "title": "Ways to Diversify — Horizontal vs. Vertical Integration",
    "content": "Corporate strategy is a search for **synergy**. Synergy = profits. Two of the three primary diversification methods involve integration:\n\n| Type | Description |\n|---|---|\n| **Horizontal Integration** | Expand into similar products serving the same customers; gains economies of scale. Example: Disney expanding into complementary entertainment |\n| **Forward Vertical Integration** | Step into your customer's domain to capture revenue. Example: Disney launching Disney+ |\n| **Backward Vertical Integration** | Step into your supplier's domain to lower costs. Example: Tesla manufacturing its own batteries |\n\n> ★ EXAM TIP: Exam frequently tests forward vs. backward integration using Tesla, Netflix, and Amazon. Ask: \"Are they moving toward the customer (forward) or toward the supplier (backward)?\""
  },
  {
    "title": "BCG Matrix — Portfolio Planning Tool",
    "content": "A tool that helps multi-business firms decide where to allocate resources. Axes: **Market Growth Rate** (Y) vs. **Relative Market Share** (X).\n\n| Quadrant | Growth | Share | Strategic Implication |\n|---|---|---|---|\n| **★ Star** | High | High | Invest to maintain leadership. Example: Marvel Studios |\n| **? Question Mark** | High | Low | Invest selectively or divest. Example: Disney+ |\n| **$ Cash Cow** | Low | High | Harvest cash; minimal investment. Example: ESPN |\n| **✗ Dog** | Low | Low | Divest or discontinue. Example: ABC Network |\n\n> ★ EXAM TIP: ESPN = Cash Cow. ABC = Dog. Marvel = Star. Disney+ = Question Mark."
  }
]
```

Notice:
- Every row has a concrete example
- Bold terms in column one
- One exam tip per segment, tied to a fact the source emphasized
- Zero filler

---

## 9. JSON Output Discipline

- Return **only** the JSON array. No backticks, no "Here is your study guide:", no closing remarks.
- Escape newlines inside strings as `\n`. Escape quotes as `\"`.
- Empty array `[]` is valid when nothing new to cover.
- Validate before returning: parseable JSON, every segment has both `title` and `content`, content length > 20 chars.

---

## 10. Self-Check Before Returning

Run this checklist mentally on every output:

- [ ] Every fact comes from the source (no invented examples, dates, names)
- [ ] No concept in `alreadyCoveredTitles` is repeated
- [ ] At least one table OR structured bullet list per segment
- [ ] Titles are specific and varied (no "What Is X?")
- [ ] Filler words and meta-statements are stripped
- [ ] Numbered sequences from the source are complete (Theory 1, 2, 3 all present)
- [ ] Where the source emphasized importance, an exam-tip callout was emitted
- [ ] JSON is valid and parseable

If any item fails, fix it before returning.
