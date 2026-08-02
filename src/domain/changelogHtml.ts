import { parseChangelog, type ChangelogRelease, type ChangelogSection } from "./changelog.ts";

// Renders CHANGELOG.md's full release history as a standalone static page — vite.config.ts's
// changelogPlugin emits this as public/changelog.html (dev + build), linked from the footer's
// version number. Same dark-theme shell (CSS variables, .back-link) as the other hand-authored
// public/*.html pages (known-issues.html, tutorials.html), but generated, not hand-maintained —
// hand-writing a second copy of every release's notes would just recreate the exact sync-risk
// fetching CHANGELOG.md itself (rather than a separate JSON) was meant to avoid.

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const PAGE_STYLE = `
      :root {
        --bg: #0a0e14;
        --bg-panel: #121824;
        --border: #2a3444;
        --accent: #ff9e1b;
        --accent-text: #ffb64d;
        --text: #e7e6e2;
        --text-dim: #8b93a1;
        --text-faint: #5b6577;
        --font-body: system-ui, "Segoe UI", sans-serif;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        padding: 32px 20px 80px;
        background: var(--bg);
        color: var(--text);
        font-family: var(--font-body);
        line-height: 1.55;
      }
      main {
        max-width: 760px;
        margin: 0 auto;
      }
      h1 {
        font-size: 1.5rem;
        margin: 0 0 4px;
      }
      .subtitle {
        color: var(--text-dim);
        margin: 0 0 32px;
        font-size: 0.95rem;
      }
      .subtitle a,
      main > a {
        color: var(--accent-text);
      }
      .back-link {
        display: inline-block;
        margin-bottom: 16px;
        color: var(--text-dim);
        text-decoration: none;
        font-size: 0.9rem;
      }
      .back-link:hover {
        color: var(--accent-text);
      }
      section {
        margin-bottom: 20px;
        background: var(--bg-panel);
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 16px 20px;
      }
      h2 {
        font-size: 1.05rem;
        margin: 0 0 8px;
      }
      .release-date {
        font-weight: normal;
        color: var(--text-dim);
        font-size: 0.85em;
      }
      h3 {
        font-size: 0.8rem;
        margin: 12px 0 4px;
        color: var(--text-dim);
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }
      ul {
        margin: 0;
        padding-left: 20px;
      }
      li {
        margin-bottom: 2px;
      }
      a {
        color: var(--accent);
      }
      footer {
        margin-top: 40px;
        color: var(--text-faint);
        font-size: 0.85rem;
      }
      footer a {
        color: var(--text-dim);
      }`;

export function renderChangelogPage(markdown: string): string {
  const releases = parseChangelog(markdown);

  const releasesHtml = releases
    .map((release: ChangelogRelease) => {
      const sectionsHtml = release.sections
        .map(
          (section: ChangelogSection) => `
        <h3>${escapeHtml(section.title)}</h3>
        <ul>
          ${section.items.map((item: string) => `<li>${escapeHtml(item)}</li>`).join("\n          ")}
        </ul>`,
        )
        .join("");
      return `
      <section id="v${release.version}">
        <h2>v${release.version} <span class="release-date">${release.date}</span></h2>${sectionsHtml}
      </section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Changelog — EDCPS</title>
    <style>${PAGE_STYLE}
    </style>
  </head>
  <body>
    <main>
      <a class="back-link" href="index.html">&larr; Back to EDCPS</a>
      <h1>Changelog</h1>
      <p class="subtitle">
        Every released feature and fix, newest first — generated straight from this project's own
        <code>CHANGELOG.md</code>. See also
        <a href="https://github.com/gaborauth/ed-colonisation-planner" target="_blank" rel="noreferrer">the GitHub repo</a>.
      </p>
${releasesHtml}
    </main>
  </body>
</html>
`;
}
