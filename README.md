# LPI Essentials Practice

A practice exam for the **LPI Linux Essentials (010-160)** certification. It runs in
the browser with no build step and no dependencies.

- **40 random questions**, the same length as the real exam, or **all 80** in the bank
- Answer and option order is shuffled on every run
- **Flag** questions to revisit, and jump to any question from the overview grid
- **Fill-in-the-blank** questions are answered by typing, as in the real exam
- A timer that turns amber once you pass real-exam pace (60 minutes per 40 questions)
- A **results review** of every question with your answer and the correct one, filtered
  to all, missed or flagged questions
- **Retry missed questions** to drill only the ones you got wrong
- Progress is saved in the browser, so you can close the tab and resume later
- Light and dark themes, keyboard shortcuts, and a layout that works on phones

## Running it

The page loads the question bank with `fetch`, so it has to be served over HTTP.
Opening `index.html` straight from disk won't work. Any static server will do:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. It also works as-is on GitHub Pages or any other
static host.

## Keyboard shortcuts

| Key            | Action                     |
| -------------- | -------------------------- |
| `A` – `E`      | Choose an answer           |
| `←` / `→`      | Previous or next question  |
| `Enter`        | Next question              |
| `F`            | Flag for review            |

## Project layout

```text
index.html          Page markup for the start, quiz and results screens
style.css           Styles, with light and dark color tokens at the top
app.js              Quiz logic: loading, rendering, scoring, saving progress
lpi_questions.json  The question bank
```

## Question format

`lpi_questions.json` is an array of question objects.

### Multiple choice

```json
{
  "id": 13,
  "question": "Which of the following `tar` options handle compression? (Choose two.)",
  "code": true,
  "options": ["-z", "-g", "-z2", "-bz", "-j"],
  "answer": ["-z", "-j"]
}
```

| Field      | Description |
| ---------- | ----------- |
| `id`       | Unique number. Saved progress refers to questions by `id`. |
| `question` | The prompt. Supports `` `inline code` ``, fenced ```` ``` ```` code blocks and blank lines between paragraphs. |
| `options`  | The choices, shown in random order. |
| `answer`   | The correct options, copied exactly from `options`. More than one answer turns the question into a "choose N" checkbox question. |
| `code`     | Optional. Set to `true` when the options are commands, paths or terminal output so they're shown in a monospace font. Options containing line breaks keep their column alignment. |

A `(Choose two.)` note in the question text is hidden during the quiz, because the
app shows its own hint based on the number of answers.

### Fill in the blank

```json
{
  "id": 56,
  "type": "text",
  "question": "What parameter of `ls` prints a recursive listing of a directory’s content?",
  "answer": ["-R", "--recursive"]
}
```

Typed answers are trimmed and compared case-sensitively, as on the command line.
The first entry in `answer` is shown as the correct answer, and the rest are listed
as also accepted.
