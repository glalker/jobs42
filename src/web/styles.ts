export const STYLES = `
:root {
  --bg: #f6f7f9; --surface: #ffffff; --text: #14171c; --muted: #5d6673; --line: #e2e6eb;
  --accent: #3b5bdb; --accent-text: #ffffff;
  --good: #1f7a4d; --good-bg: #e3f4ea; --warn: #8a5a00; --warn-bg: #fdf0cf;
  --bad: #b3261e; --bad-bg: #fbe4e2; --idle: #5d6673; --idle-bg: #eceff3;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1216; --surface: #181c22; --text: #e9ecf0; --muted: #9aa4b1; --line: #2a303a;
    --accent: #8da2fb; --accent-text: #0f1216;
    --good: #6fd3a0; --good-bg: #163527; --warn: #f0c35c; --warn-bg: #3a2e0f;
    --bad: #f2928b; --bad-bg: #3d1a18; --idle: #9aa4b1; --idle-bg: #232932;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color: var(--accent); }
main { max-width: 860px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 1.7rem; line-height: 1.2; margin: 0 0 6px; text-wrap: balance; }
h2 { font-size: 1.05rem; margin: 28px 0 10px; }
.sub { color: var(--muted); margin: 0 0 20px; }
.brand { font-weight: 700; text-decoration: none; color: var(--text); display: inline-block; margin-bottom: 18px; }
form.filters { display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: center; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 12px; margin-bottom: 18px; }
form.filters input[type=search], form.filters select { font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--text); }
form.filters input[type=search] { flex: 1 1 200px; min-width: 0; }
form.filters label { display: inline-flex; gap: 6px; align-items: center; color: var(--muted); font-size: .92rem; }
button, .button { font: inherit; font-weight: 600; padding: 8px 16px; border-radius: 8px; border: 1px solid var(--accent); background: var(--accent); color: var(--accent-text); cursor: pointer; text-decoration: none; display: inline-block; }
.button.secondary { background: transparent; color: var(--accent); }
ul.jobs { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
ul.jobs li { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
.job-title { font-weight: 650; font-size: 1.05rem; text-decoration: none; overflow-wrap: anywhere; }
.meta { color: var(--muted); font-size: .92rem; margin: 2px 0 8px; overflow-wrap: anywhere; }
.row { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; }
.tag { font-size: .78rem; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: var(--idle-bg); color: var(--idle); }
.badge { font-size: .8rem; font-weight: 650; padding: 3px 10px; border-radius: 999px; }
.badge.hiring { background: var(--good-bg); color: var(--good); }
.badge.unclear { background: var(--warn-bg); color: var(--warn); }
.badge.unlikely { background: var(--bad-bg); color: var(--bad); }
.badge.insufficient, .badge.closed { background: var(--idle-bg); color: var(--idle); }
.reason { color: var(--muted); font-size: .88rem; }
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 16px; }
ul.signals, ol.history { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
ul.signals li::before { content: "•"; font-weight: 700; margin-right: 8px; }
ul.signals li.good::before { color: var(--good); }
ul.signals li.bad::before { color: var(--bad); }
ul.signals li.neutral::before { color: var(--idle); }
ol.history time { color: var(--muted); font-variant-numeric: tabular-nums; margin-right: 10px; }
.description { white-space: pre-wrap; overflow-wrap: anywhere; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 18px 0 4px; }
nav.pages { display: flex; justify-content: space-between; margin-top: 18px; }
.empty { color: var(--muted); padding: 32px 0; text-align: center; }
`;
