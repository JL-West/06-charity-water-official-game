# Charity: water Game Prototype

In this project, you’ll begin transforming your game concept from last week into a working interactive prototype using HTML, CSS, and JavaScript.

This first version should focus on core functionality — clickable elements, score tracking, and a basic layout. The goal is to bring your idea to life with simple, working mechanics that you’ll refine and expand in the next milestone.

## Quick start

Prerequisites: Node.js (for the smoke test) and Python 3 (for the simple preview server) are available in the devcontainer.

1. Install dependencies (only needed if you change dev dependencies):

```bash
npm install
```

2. Start a quick preview server and open the app in your browser:

```bash
npm run preview
# then open http://127.0.0.1:8000
```

3. Run the headless smoke test (Node + jsdom) to assert the simple loader works:

```bash
npm run smoke
```

What the smoke test does
- Loads `index.html` in jsdom, clicks the **Continue (Load)** button, waits for the loader animation to finish, and asserts the loader is hidden.

Notes
- The project uses a small, robust simple loader (`#simpleLoader`) for reliability across browsers. A more decorative jerrycan loader was removed because it caused cross-browser timing and rendering issues during development.

If you'd like, I can add a tiny GitHub Actions workflow to run `npm run smoke` on PRs to catch regressions.
