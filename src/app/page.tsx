"use client";

import React, { useRef, useEffect } from "react";
import dynamic from "next/dynamic";

const Editor = dynamic(() => import("../components/Editor"), { ssr: false });

const text = `Vishnu is a verrry wonderrful pasionate good boy.

His wife is Ammu, a veutiful girl!`;

const App = () => {
  const ydoc = useRef(null);
  const provider = useRef(null);
  const ytext = useRef(null);
  const binding = useRef(null);
  const editor = useRef(null);
  const timer = useRef(null);

  const canceled = useRef(true);
  const isFixing = useRef(false);

  // 1 second of no keyboard activity before calling the fix API.
  const FIX_WAIT_TIME = 1000;

  // Automatically call the fix API when the user stops typing for a second.
  // and the cancel API when the user starts typing again.
  function onEditorChange(change, _delta, _oldDelta, source) {
    if (source !== "user") {
      canceled.current = false;
      return;
    }

    if (!canceled.current) {
      onCancelClick();
      canceled.current = true;
    }

    if (change === "text-change") {
      if (timer.current) {
        clearTimeout(timer.current);
      }

      const newTimer = setTimeout(() => {
        onFixClick();
        timer.current = null;
      }, FIX_WAIT_TIME);

      timer.current = newTimer;
    }
  }

  function onFixClick() {
    if (isFixing.current) {
      return;
    }

    const text = editor.current?.getText();
    isFixing.current = true;

    fetch("/api/fix", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    })
      .then((res) => res.json())
      .then((data) => {
        isFixing.current = false;
        console.log("fix", data);
      })
      .catch((err) => {
        isFixing.current = false;
        console.error(err);
      });
  }

  function onCancelClick() {
    fetch("/api/cancel", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    })
      .then((res) => res.json())
      .then((data) => {
        console.log("canceled", data);
      })
      .catch((err) => {
        console.error(err);
      });
  }

  useEffect(() => {
    console.log(editor.current);
  });

  return (
    <>
      <Editor
        ydoc={ydoc}
        provider={provider}
        ytext={ytext}
        binding={binding}
        editor={editor}
        initialText={text}
        onFixClick={onFixClick}
        onCancelClick={onCancelClick}
        onEditorChange={onEditorChange}
      />
    </>
  );
};

export default App;
