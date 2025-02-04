"use client";

import { useEffect, useRef } from "react";

import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { QuillBinding } from "y-quill";
import Quill, { Delta } from "quill";
import QuillCursors from "quill-cursors";

import "quill/dist/quill.snow.css";

type EditorProps = {
  ydoc: React.RefObject<Y.Doc | null>;
  provider: React.RefObject<WebsocketProvider | null>;
  ytext: React.RefObject<Y.Text | null>;
  binding: React.RefObject<QuillBinding | null>;
  editor: React.RefObject<Quill | null>;
  onEditorChange?: (
    change: string,
    delta: Delta,
    oldDelta: Delta,
    source: string
  ) => void;
  onFixClick?: () => void;
  onCancelClick?: () => void;
  initialText: string;
};

function Editor({
  ydoc,
  provider,
  ytext,
  binding,
  editor,
  onEditorChange,
  onFixClick = () => {},
  onCancelClick = () => {},
}: EditorProps) {
  const editorContainer = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Wait until editorContainer.
    if (editorContainer.current === null) {
      return;
    }

    // Don't double-laod.
    if (document.querySelector(".ql-cursors")) {
      return;
    }

    Quill.register("modules/cursors", QuillCursors);
    Quill.register("modules/formats", QuillCursors);
    ydoc.current = new Y.Doc();
    provider.current = new WebsocketProvider(
      `ws://localhost:3000/ws`,
      "quill-demo-2024/06",
      ydoc.current
    );
    ytext.current = ydoc.current.getText("quill");

    editor.current = new Quill(editorContainer.current, {
      modules: {
        cursors: true,
        formats: [],
        toolbar: "#toolbar",
        history: {
          maxStack: 500,
        },
      },
      placeholder: "Start collaborating...",
      theme: "snow", // or 'bubble'
    });

    binding.current = new QuillBinding(
      ytext.current,
      editor.current,
      provider.current.awareness
    );

    if (provider.current.awareness) {
      provider.current.awareness.setLocalStateField("user", {
        name: "Typing Jimmy",
        color: "blue",
      });
    }

    if (onEditorChange) {
      editor.current.on("editor-change", onEditorChange);
    }
  }, [binding, provider, ydoc, ytext, editor, onEditorChange]);

  return (
    <div className="p-10">
      <div id="toolbar">
        <button
          id="fix-button"
          className="border-black border p-2"
          onClick={onFixClick}
        >
          ✍🏼
        </button>
        <button
          id="cancel-button"
          className="border-black border p-2"
          onClick={onCancelClick}
        >
          🚫
        </button>
      </div>
      <div id="editor"></div>
      <div className="min-h-96" ref={editorContainer}></div>
    </div>
  );
}

export default Editor;
