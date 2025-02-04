import { createServer } from "http";
import { WebSocketServer } from "ws";
import { parse } from "url";
import next from "next";

import { setupWSConnection, docs } from "y-websocket/bin/utils";

import OpenAI from "openai";
import difflib from "difflib";

import { createRelativePositionFromTypeIndex } from "yjs";

const prompt = `
This is a text structure in JSON:

{"text": <TEXT> }

You will respond with corrected text based on parameters.

# Parameters

## Elementary Rules of Usage
* Use active voice (e.g., “The cat chased the mouse,” not “The mouse was chased by the cat”).
* Use definite, specific, and concrete language (avoid vague or abstract words).
* Omit needless words (e.g., “He is a man who” → “He”).
* Use parallel structure (e.g., “She likes reading, writing, and painting,” not “She likes reading, writing, and to paint”).
* Use a comma before conjunctions in compound sentences (“I went home, and I slept”).
* Do not join independent clauses with a comma (use a semicolon, conjunction, or separate sentences).
* Avoid passive voice unless necessary (e.g., “Mistakes were made” is vague—say who made them).

Principles of Composition
* Use the positive form (say what is, not what is not).
* Put the most important idea at the end of the sentence for emphasis.
* Avoid overuse of qualifiers (“rather,” “very,” “little,” “pretty” often weaken writing).
* Revise and rewrite (good writing is concise and refined).
* Keep related words together (e.g., “He only found three errors” → “He found only three errors”).
* Express coordinate ideas in similar form (parallelism makes writing stronger).

Matters of Form
* Prefer simple, familiar words (don’t use jargon or pretentious language).
* Avoid fancy words (“utilize” → “use,” “facilitate” → “help”).
* Use figures of speech sparingly (metaphors should be fresh and appropriate).
* Do not over-explain (assume the reader is intelligent).

Approach to Style
* Write naturally but not casually (formal yet readable).
* Avoid overuse of adverbs (e.g., “He shouted angrily” → “He shouted”).
* Use orthodox spelling and grammar (avoid trendy, incorrect usages).
* Do not affect a breezy style (overly casual writing can sound insincere).
* Be clear (if the reader struggles, the writing has failed).

In short: Be clear, be concise, and respect the reader's time.


Important:
- Preserve newlines and number of lines, never change them!

---
%%text%%
---

Respond with the same structure in JSON.
`;

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();
const port = parseInt(process.env.PORT, 10) || 3000;

let operationsLoop = null;
let operationPerformed = null;

function applyDeltaToDoc(ydoc, ops) {
  // Constant to simulate a high-latency connection when sending
  // text changes.
  const TEXT_LATENCY = 400;

  let i = 0;
  let j = 0;

  let selections = findSelectionsFromOps(ops);
  operationPerformed = null;

  operationsLoop = setInterval(() => {
    if (ydoc && j < selections.length && operationPerformed !== "selection") {
      const ytext = ydoc.getText("quill");
      const anchor = createRelativePositionFromTypeIndex(
        ytext,
        selections[j].index
      );
      const head = createRelativePositionFromTypeIndex(
        ytext,
        selections[j].index + selections[j].length
      );

      ydoc.awareness.setLocalState({
        user: {
          name: "AI",
          color: "red",
        },
        cursor: {
          anchor,
          head,
        },
      });

      j++;
      operationPerformed = "selection";
      return;
    }

    if (ydoc && i < ops.length && operationPerformed !== "insertion") {
      const ytext = ydoc.getText("quill");
      ytext.applyDelta(ops[i]);
      i++;
      operationPerformed = "insertion";
      return;
    }

    if (i >= ops.length && j >= selections.length) {
      operationPerformed = null;
    }
  }, TEXT_LATENCY);
}

function findSelectionsFromOps(ops) {
  const selections = [];

  for (const op of ops) {
    let selectionIndex = 0;
    for (let i = 0; i < op.length; i++) {
      if (op[i].retain) {
        selectionIndex = op[i].retain;
      }

      if (op[i].delete && op?.[i + 1]?.insert) {
        selections.push({
          index: selectionIndex,
          length: op[i + 1].insert.length,
        });
        continue;
      }

      if (op[i].delete) {
        selections.push({ index: selectionIndex, length: op[i].delete });
        continue;
      }

      if (op[i].insert && !op?.[i - 1]?.delete) {
        selections.push({
          index: selectionIndex,
          length: op[i].insert.length,
        });
        continue;
      }
    }
  }

  // move cursor to start.
  selections.push({ index: 0, length: 0 });

  return selections;
}

/**
 * Get body of streaming request
 *
 * @param {IncomingMessage} request
 * @returns
 */
function getBody(request) {
  return new Promise((resolve) => {
    const bodyParts = [];
    let body;
    request
      .on("data", (chunk) => {
        bodyParts.push(chunk);
      })
      .on("end", () => {
        body = Buffer.concat(bodyParts).toString();
        resolve(body);
      });
  });
}

/**
 * Function to convert opcodes to QuillJS delta format
 */
function opcodesToDelta(opcodes, destinationString, startingIndex = 0) {
  const delta = [];
  let index = startingIndex;
  opcodes.forEach(([tag, i1, i2, j1, j2]) => {
    if (tag === "equal") {
      index += i2 - i1;
    } else if (tag === "delete") {
      const ops = [];
      ops.push({ retain: index });
      ops.push({ delete: i2 - i1 });

      delta.push(ops);
    } else if (tag === "insert") {
      const ops = [];
      if (index !== 0) {
        ops.push({ retain: index });
      }
      ops.push({ insert: destinationString.slice(j1, j2) });
      delta.push(ops);
      index += i2 - i1 + j2 - j1;
    } else if (tag === "replace") {
      const ops = [];
      if (index !== 0) {
        ops.push({ retain: index });
      }
      ops.push({ delete: i2 - i1 });
      ops.push({ insert: destinationString.slice(j1, j2) });
      delta.push(ops);
      index += j2 - j1;
    }
  });
  return [delta, index];
}

/**
 * Get changes between two strings in Delta format
 * See: https://quilljs.com/docs/delta/
 *
 * @param {string} a The source line
 * @param {string} b The destination line
 */
function deltaOpsFromLines(a, b) {
  const a_lines = a.split("\n");
  const b_lines = b.split("\n");

  const deltas = [];
  let line_length = 0;

  for (let i = 0; i < a_lines.length; i++) {
    const line = a_lines[i];
    const line2 = b_lines[i];

    const diff = new difflib.SequenceMatcher(null, line, line2);
    const opcodes = diff.getOpcodes();
    const [delta, index] = opcodesToDelta(opcodes, line2, line_length);
    deltas.push(...delta);
    line_length = index + 1; //newline;
  }

  return deltas;
}

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    const parsedUrl = parse(req.url, true);

    if (parsedUrl.pathname === "/api/fix") {
      // Don't fix again when an operation is being performed. Wait for a cancel.
      if (operationPerformed !== null) {
        console.log("Not performing as one already exists");
        res.end(JSON.stringify({ success: false }));
        return;
      }

      const textJSON = await getBody(req);

      const openai = new OpenAI();
      const chatCompletion = await openai.chat.completions.create({
        model: "gpt-4o",
        response_format: { type: "json_object" },
        messages: [
          { role: "developer", content: prompt.replace("%%text%%", textJSON) },
        ],
      });

      console.log(textJSON);
      console.log(chatCompletion.choices[0].message.content);

      const text = JSON.parse(textJSON);
      const correctedText = JSON.parse(
        chatCompletion.choices[0].message.content
      );

      const ops = deltaOpsFromLines(text.text, correctedText.text);

      console.log(ops);

      // Apply changes to the document.
      const ydoc = docs.get("ws/quill-demo-2024/06");
      applyDeltaToDoc(ydoc, ops);

      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ success: true }));
    }

    if (parsedUrl.pathname === "/api/cancel") {
      if (operationsLoop) {
        clearInterval(operationsLoop);
        operationsLoop = null;
        operationPerformed = null;
      }

      res.end(JSON.stringify({ success: true }));
    }

    handle(req, res, parsedUrl);
  });
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", async function connection(ws, req) {
    console.log("incoming connection");

    setupWSConnection(ws, req, {
      gc: req.url.slice(1) !== "ws/prosemirror-versions",
    });

    ws.onclose = () => {
      console.log("connection closed", wss.clients.size);
    };
  });

  server.on("upgrade", function (req, socket, head) {
    const { pathname } = parse(req.url, true);
    if (pathname !== "/_next/webpack-hmr") {
      wss.handleUpgrade(req, socket, head, function done(ws) {
        wss.emit("connection", ws, req);
      });
    }
  });

  server.listen(port, (err) => {
    if (err) throw err;
    console.log(
      `> Ready on http://localhost:${port} and ws://localhost:${port}`
    );
  });
});
