"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [files, setFiles] = useState<string[]>([]);

  async function upload() {
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    loadFiles();
  }

  async function loadFiles() {
    const res = await fetch("/api/list"); // optional (see below)
    const data = await res.json();
    setFiles(data.files);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: just a prototype
  useEffect(() => {
    loadFiles();
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h1>Upload</h1>

      <input
        type="file"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
      />

      {/** biome-ignore lint/a11y/useButtonType: it's just a test for now */}
      <button onClick={upload}>Upload</button>

      <h2>Files</h2>

      <ul>
        {files.map((f) => (
          <li key={f}>
            {f} <a href={`/api/download/${f}`}>Download</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
